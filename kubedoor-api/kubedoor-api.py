import json
import sys
import time
import base64
import requests
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from kubernetes import client
from kubernetes.client import Configuration
from kubernetes.client.rest import ApiException
from loguru import logger
import utils

logger.remove()
logger.add(
    sys.stderr,
    format='<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> [<level>{level}</level>] <level>{message}</level>',
    level='INFO',
)


app = Flask(__name__)


# 加载集群内的配置
def load_incluster_config():
    with open('/var/run/secrets/kubernetes.io/serviceaccount/token', 'r') as token_file:
        token = token_file.read()
    configuration = Configuration()
    configuration.host = "https://kubernetes.default.svc"
    configuration.verify_ssl = True
    configuration.ssl_ca_cert = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt'
    configuration.api_key = {"authorization": f"Bearer {token}"}

    return configuration


def get_authorization_header(username, password):
    credentials = f'{username}:{password}'
    encoded_credentials = base64.b64encode(credentials.encode('utf-8')).decode('utf-8')
    return f'Basic {encoded_credentials}'


def delete_cronjob_or_not(cronjob_name, job_type):
    """判断是否是一次性job，是的话删除"""
    if job_type == "once":
        try:
            config = load_incluster_config()
            client.Configuration.set_default(config)
            batch_v1 = client.BatchV1Api()
            # 删除 CronJob
            batch_v1.delete_namespaced_cron_job(
                name=cronjob_name,
                namespace="kubedoor",
                body=client.V1DeleteOptions()
            )
            logger.info(f"CronJob '{cronjob_name}' deleted successfully.")
        except ApiException as e:
            logger.exception("调用AppsV1Api时出错: {}", e)
            utils.send_msg(f"Error when deleting CronJob '{cronjob_name}'!")
    return


@app.route('/api/sql', methods=['POST'])
def forward_request():
    data = request.data.replace(b'__KUBEDOORDB__', utils.CK_DATABASE.encode())
    logger.info(str(data))
    TARGET_URL = f'http://{utils.CK_HOST}:{utils.CK_HTTP_PORT}/?add_http_cors_header=1&default_format=JSONCompact'
    headers = {'Authorization': get_authorization_header(utils.CK_USER, utils.CK_PASSWORD), 'Content-Type': 'text/plain'}
    response = requests.post(TARGET_URL, data=data, headers=headers)
    if response.text:
        return jsonify(response.json())
    else:
        return jsonify({})


@app.route('/api/scale', methods=['POST'])
def scale():
    """批量扩缩容"""
    request_info = request.get_json()
    interval = request.args.get("interval")

    # 创建 API 实例
    config = load_incluster_config()
    client.Configuration.set_default(config)
    v1 = client.AppsV1Api()

    error_list = list()
    for index, deployment in enumerate(request_info):
        namespace = deployment.get("namespace")
        deployment_name = deployment.get("deployment_name")
        num = deployment.get("num")
        job_name = deployment.get("job_name")
        job_type = deployment.get("job_type")
        logger.info(f"【{namespace}】【{deployment_name}】: {num}")
        try:
            # 获取当前的 Deployment
            deployment_obj = v1.read_namespaced_deployment(deployment_name, namespace)
            if not deployment_obj:
                logger.error(f"未找到【{namespace}】【{deployment_name}】", flush=True)
            # 修改副本数
            deployment_obj.spec.replicas = num
            # 更新 Deployment
            logger.info(
                f"Deployment【{deployment_name}】副本数更改为 {deployment_obj.spec.replicas} ，实际变动见webhook执行情况", flush=True
            )
            v1.patch_namespaced_deployment_scale(deployment_name, namespace, deployment_obj)
            # 间隔时间
            if interval and index != len(request_info) - 1:
                logger.info(f"暂停{interval}s...")
                time.sleep(int(interval))
            if job_name:
                utils.send_msg(f"'{deployment_name}' has been scaled!")
        except ApiException as e:
            logger.exception("调用AppsV1Api时出错: {}", e)
            error_list.append({'namespace': namespace, 'deployment_name': deployment_name})

        if job_name:
            delete_cronjob_or_not(job_name, job_type)

    return {"message": "ok", "error_list": error_list}


@app.route('/api/restart', methods=['POST'])
def reboot():
    """批量重启微服务"""
    request_info = request.get_json()
    interval = request.args.get("interval")

    # 创建 API 实例
    config = load_incluster_config()
    client.Configuration.set_default(config)
    v1 = client.AppsV1Api()

    patch = {
        "spec": {
            "template": {"metadata": {"annotations": {"kubectl.kubernetes.io/restartedAt": datetime.now().isoformat()}}}
        }
    }

    error_list = list()
    for index, deployment in enumerate(request_info):
        job_name = deployment.get("job_name")
        job_type = deployment.get("job_type")
        namespace = deployment.get("namespace")
        deployment_name = deployment.get("deployment_name")
        logger.info(f"【{namespace}】【{deployment_name}】")
        try:
            # 获取当前的 Deployment
            deployment_obj = v1.read_namespaced_deployment(deployment_name, namespace)
            if not deployment_obj:
                logger.error(f"未找到【{namespace}】【{deployment_name}】", flush=True)

            # 重启 Deployment
            logger.info(f"重启Deployment【{deployment_name}】，实际变动见webhook执行情况", flush=True)
            v1.patch_namespaced_deployment(deployment_name, namespace, patch)
            # 间隔时间
            if interval and index != len(request_info) - 1:
                logger.info(f"暂停{interval}s...")
                time.sleep(int(interval))
            if job_name:
                utils.send_msg(f"'{deployment_name}' has been restarted!")
        except ApiException as e:
            logger.exception("调用AppsV1Api时出错: {}", e)
            error_list.append({'namespace': namespace, 'deployment_name': deployment_name})

        if job_name:
            delete_cronjob_or_not(job_name, job_type)

    return {"message": "ok", "error_list": error_list}


@app.route('/api/table', methods=['POST'])
def table():
    """初始化/更新原始资源表k8s_resources，初始化/更新资源管控表k8s_res_control"""

    # 采集最近几天的数据，包括当天
    env = utils.PROM_K8S_TAG_KEY
    days = request.args.get("days") or 2  # 不传则采集昨天+今天
    namespace_str = utils.NAMESPACE_LIST.replace(",", "|")
    duration_str, end_time_part = utils.calculate_peak_duration_and_end_time(utils.PEAK_TIME)
    for i in range(0, int(days)):
        # 计算结束时间字符串
        current_date = datetime.now().date()
        end_time_full = datetime.combine(current_date, end_time_part) - timedelta(days=i)
        if datetime.now() < end_time_full:
            logger.info(f"今天的高峰期还未结束，跳过{current_date}的数据采集")
            continue
        utils.check_and_delete_day_data(end_time_full)
        logger.info(f"获取{end_time_full}的数据========================================")
        k8s_metrics_list = utils.merged_dict(env, namespace_str, duration_str, end_time_full)
        utils.metrics_to_ck(k8s_metrics_list)

    # 采集完成后，取最近10天cpu数据最高的一天pod，数据写入管控表
    resources = utils.get_list_from_resources()
    if utils.is_init_or_update():
        # 初始化
        logger.info("初始化管控表=======")
        utils.init_control_data(resources)
    else:
        # 更新
        logger.info("更新管控表=======")
        utils.update_control_data(resources)
    return "ok"


@app.route('/api/cron', methods=['POST'])
def cron():
    """创建定时任务，执行扩缩容"""
    request_info = request.get_json()
    cron = request_info.get("cron")  # 周期性定时任务，传cron表达式，形如"*/10 * * * *"
    time = request_info.get("time")  # 一次性定时任务，传列表，形如[2024,12,25,11,1]
    type = request_info.get("type")  # 扩缩容scale、重启restart
    service = request_info.get("service")

    # 加载配置
    config = load_incluster_config()
    client.Configuration.set_default(config)
    batch_v1 = client.BatchV1Api()

    # 构造变量
    deployment_name = service[0].get("deployment_name")
    name_pre = ""
    job_type = ""
    cron_new = ""
    if time:
        name_pre = f"{type}-once-{deployment_name}"
        job_type = "once"
        cron_new = f"{str(time[4])} {time[3]} {time[2]} {time[1]} *"
    if cron:
        name_pre = f"{type}-cron-{deployment_name}"
        job_type = "cron"
        cron_new = cron
    service[0]["job_name"] = name_pre
    service[0]["job_type"] = job_type

    # 定义 CronJob 规范
    cronjob = client.V1CronJob(
        metadata=client.V1ObjectMeta(name=name_pre),
        spec=client.V1CronJobSpec(
            schedule=cron_new,
            job_template=client.V1JobTemplateSpec(
                spec=client.V1JobSpec(
                    template=client.V1PodTemplateSpec(
                        metadata=client.V1ObjectMeta(labels={"app": name_pre}),
                        spec=client.V1PodSpec(
                            restart_policy="Never",
                            containers=[
                                client.V1Container(
                                    name=name_pre,
                                    image="registry.cn-shenzhen.aliyuncs.com/starsl/busybox-curl",
                                    command=[
                                        "curl",
                                        "-X",
                                        "POST",
                                        "-H",
                                        "Content-Type: application/json",
                                        "-d",
                                        f'{json.dumps(service)}',
                                        f"http://kubedoor-api.ops.casstime.net/api/{type}"
                                    ],
                                    env=[
                                        client.V1EnvVar(name="CRONJOB_TYPE", value=job_type)
                                    ],
                                )
                            ],
                        ),
                    )
                )
            ),
        ),
    )

    # 创建 CronJob
    namespace = "kubedoor"
    try:
        batch_v1.create_namespaced_cron_job(namespace=namespace, body=cronjob)
    except Exception as e:
        if e.body:
            body = json.loads(e.body)
            error_message = body.get("message")
        else:
            error_message = "执行失败"
        logger.error(error_message)
        return {"error_message": error_message}, 500
    content = f"CronJob '{name_pre}' created successfully in namespace '{namespace}'."
    logger.info(content)
    utils.send_msg(content)
    return "ok"


def update_namespace_lable(action):
    """命名空间修改标签"""
    # 加载配置
    config = load_incluster_config()
    client.Configuration.set_default(config)
    core_v1_api = client.CoreV1Api()

    # 构造标签的 Patch 数据
    namespace_name = "kube-system"
    label_key = "kubedoor-ignore"
    label_value = None
    if action == "add":
        label_value = 'true'
    patch_body = {
        "metadata": {
            "labels": {
                label_key: label_value
            }
        }
    }
    try:
        # 调用 patch_namespace 方法更新命名空间的标签
        response = core_v1_api.patch_namespace(name=namespace_name, body=patch_body)
        if action == "add":
            logger.info(f"Label '{label_key}: {label_value}' added to namespace '{namespace_name}' successfully.")
        else:
            logger.info(f"Label '{label_key}' removed from namespace '{namespace_name}' successfully.")
        logger.info(f"Updated namespace labels: {response.metadata.labels}")
    except client.exceptions.ApiException as e:
        logger.error(f"Exception when patching namespace '{namespace_name}': {e}")


def get_mutating_webhook():
    """获取 MutatingWebhookConfiguration"""
    # 加载配置
    config = load_incluster_config()
    client.Configuration.set_default(config)
    admission_api = client.AdmissionregistrationV1Api()

    # 定义目标 Webhook 的名称
    webhook_name = "kubedoor-webhook-configuration"

    try:
        # 尝试读取指定的 MutatingWebhookConfiguration
        webhook = admission_api.read_mutating_webhook_configuration(name=webhook_name)
        logger.info(f"MutatingWebhookConfiguration '{webhook_name}' exists.")
        return {"is_on": True}
    except client.exceptions.ApiException as e:
        if e.status == 404:
            logger.error(f"MutatingWebhookConfiguration '{webhook_name}' does not exist.")
            return {"is_on": False}
        else:   
            if e.body:
                body = json.loads(e.body)
                error_message = body.get("message")
            else:
                error_message = "执行失败"
            logger.error(f"Exception when reading MutatingWebhookConfiguration: {e}")
            return {"error_message": error_message}, 500


def create_mutating_webhook():
    """创建 MutatingWebhookConfiguration"""
    webhook_name = "kubedoor-webhook-configuration"
    namespace = "kubedoor"

    # 加载配置
    config = load_incluster_config()
    client.Configuration.set_default(config)
    admission_api = client.AdmissionregistrationV1Api()

    # 定义 MutatingWebhookConfiguration 对象
    webhook_config = client.V1MutatingWebhookConfiguration(
        metadata=client.V1ObjectMeta(
            name=webhook_name,
            labels={
                "name": "kubedoor-webhook"
            },
            annotations={
                "cert-manager.io/inject-ca-from": "kubedoor/kubedoor-webhook-cert"
            }        
        ),
        webhooks=[
            client.V1MutatingWebhook(
                name="kubedoor-webhook.kubedoor.svc",
                client_config=client.AdmissionregistrationV1WebhookClientConfig(
                    service=client.AdmissionregistrationV1ServiceReference(
                        namespace=namespace,
                        name="kubedoor-webhook",
                        path="/mutate",
                        port=443
                    ),
                    ca_bundle=None  # cert-manager 自动注入证书，ca_bundle 留空
                ),
                rules=[
                    client.V1RuleWithOperations(
                        operations=["CREATE", "UPDATE"],
                        api_groups=["apps"],
                        api_versions=["v1"],
                        resources=["deployments", "deployments/scale"],
                        scope="*"
                    )
                ],
                failure_policy="Fail",
                match_policy="Equivalent",
                namespace_selector=client.V1LabelSelector(
                    match_expressions=[
                        client.V1LabelSelectorRequirement(
                            key="kubedoor-ignore",
                            operator="DoesNotExist"
                        )
                    ]
                ),
                side_effects="None",
                timeout_seconds=10,
                admission_review_versions=["v1"],
                reinvocation_policy="Never"
            )
        ]
    )
    # 创建 MutatingWebhookConfiguration
    try:
        response = admission_api.create_mutating_webhook_configuration(body=webhook_config)
        logger.info("MutatingWebhookConfiguration created:", response.metadata.name)
        # 命名空间kube-system添加标签
        update_namespace_lable("add")
    except client.exceptions.ApiException as e:
        if e.body:
            body = json.loads(e.body)
            error_message = body.get("message")
        else:
            error_message = "执行失败"
        logger.error(f"Exception when creating MutatingWebhookConfiguration: {e}")
        return {"error_message": error_message}


def delete_mutating_webhook():
    """删除 MutatingWebhookConfiguration"""
    # 加载配置
    config = load_incluster_config()
    client.Configuration.set_default(config)
    admission_api = client.AdmissionregistrationV1Api()

    # 定义目标 Webhook 的名称
    webhook_name = "kubedoor-webhook-configuration"

    try:
        # 删除指定的 MutatingWebhookConfiguration
        response = admission_api.delete_mutating_webhook_configuration(name=webhook_name)
        logger.info(f"MutatingWebhookConfiguration '{webhook_name}' deleted successfully.")
        # 命名空间kube-system删除标签
        update_namespace_lable("delete")
    except client.exceptions.ApiException as e:
        if e.body:
            body = json.loads(e.body)
            error_message = body.get("message")
        else:
            error_message = "执行失败"
        logger.error(f"Exception when deleting MutatingWebhookConfiguration: {e}")
        return {"error_message": error_message}


@app.route('/api/webhook_switch', methods=['GET'])
def webhook_switch():
    action = request.args.get("action")
    res = get_mutating_webhook()
    
    if action == "get":
        return res
    if action == "on":
        if res.get("is_on") == True:
            return {"error_message": "Webhook is already opened!"}, 500
        create_res = create_mutating_webhook()
        if create_res:
            return create_res, 500
    if action == "off":
        if res.get("is_on") == False:
            return {"error_message": "Webhook is already closed!"}, 500
        delete_res = delete_mutating_webhook()
        if delete_res:
            return delete_res, 500
    
    return "ok"


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=80, debug=True)