// import "./reset.css";
// import dayjs from "dayjs";
import editForm from "../form/index.vue";
import scale from "../scale/index.vue";
import { message } from "@/utils/message";
import {
  addDialog,
  type ButtonProps,
  closeDialog
} from "@/components/ReDialog";
// import headerOperator from "../headerOperator.vue";
import type { FormItemProps } from "../utils/types";
import { deviceDetection } from "@pureadmin/utils";
import {
  getResourceList,
  getNamespace,
  getDeployment,
  addData,
  editData,
  execCapacity,
  execTimeCron,
  rebootResource,
  getMaxDay
} from "@/api/resource";
// import { ElMessageBox } from "element-plus";
import { type Ref, h, ref, reactive, onMounted } from "vue";
import { transformI18n } from "@/plugins/i18n";

export function useResource(tableRef: Ref) {
  const queryForm = reactive({
    namespace: "",
    deployment: "",
    keyword: ""
  });
  const namespaceList = ref([]);
  const deploymentList = ref([]);
  const editFormRef = ref();
  const ScaleRef = ref();
  const dataList = ref([]);
  const loading = ref(true);
  const selectedNum = ref(0);
  const searchTimer = ref(null);

  const maxDay = ref("");

  // const isKunlun = ref(true);
  // const envRef = ref();

  const columns: TableColumnList = [
    {
      label: "勾选列", // 如果需要表格多选，此处label必须设置
      type: "selection",
      fixed: "left",
      reserveSelection: true // 数据刷新后保留选项
    },
    {
      label: transformI18n("resource.column.namespace"),
      prop: "namespace",
      sortable: true,
      resizable: true,
      showOverflowTooltip: true
    },
    {
      label: transformI18n("resource.column.deployment"),
      prop: "deployment",
      minWidth: 150,
      sortable: true,
      resizable: true,
      showOverflowTooltip: true
    },
    {
      label: transformI18n("resource.column.podCountInit"),
      width: 100,
      prop: "pod_count_init",
      hide: true,
      sortable: true
    },
    {
      label: transformI18n("resource.column.podCount"),
      prop: "pod_count",
      sortable: true,
      headerRenderer: () => {
        return h("span", { style: { color: "red" } }, [
          h("span", {}, transformI18n("resource.column.podCount"))
        ]);
      }
    },
    {
      label: transformI18n("resource.column.podCountAi"),
      prop: "pod_count_ai",
      sortable: true,
      hide: true
    },
    {
      label: transformI18n("resource.column.podCountManual"),
      prop: "pod_count_manual",
      sortable: true
    },
    {
      label: transformI18n("resource.column.p95PodCpuPct"),
      prop: "p95_pod_cpu_pct",
      sortable: true,
      headerRenderer: () => {
        return h("span", { style: { color: "red" } }, [
          h("span", {}, transformI18n("resource.column.p95PodCpuPct"))
        ]);
      },
      formatter: ({ p95_pod_cpu_pct }) => p95_pod_cpu_pct.toFixed(2) + "%"
    },
    {
      label: transformI18n("resource.column.podQps"),
      prop: "pod_qps",
      sortable: true,
      hide: true,
      formatter: ({ pod_qps }) => (pod_qps ? pod_qps.toFixed(2) : 0)
    },
    {
      label: transformI18n("resource.column.podQpsAi"),
      prop: "pod_qps_ai",
      hide: true,
      sortable: true,
      formatter: ({ pod_qps_ai }) => (pod_qps_ai ? pod_qps_ai.toFixed(2) : 0)
    },
    {
      label: transformI18n("resource.column.podLoadAi"),
      prop: "pod_load_ai",
      hide: true,
      sortable: true
    },
    {
      label: transformI18n("resource.column.podG1gcQps"),
      prop: "pod_g1gc_qps",
      hide: true,
      sortable: true,
      formatter: ({ pod_g1gc_qps }) =>
        pod_g1gc_qps ? pod_g1gc_qps.toFixed(2) : 0
    },
    {
      label: transformI18n("resource.column.requestCpuM"),
      prop: "request_cpu_m",
      sortable: true,
      headerRenderer: () => {
        return h("span", { style: { color: "red" } }, [
          h("span", {}, transformI18n("resource.column.requestCpuM"))
        ]);
      }
    },
    {
      label: transformI18n("resource.column.limitCpuM"),
      prop: "limit_cpu_m",
      sortable: true
    },
    {
      label: transformI18n("resource.column.p95PodMemPct"),
      prop: "p95_pod_mem_pct",
      sortable: true,
      headerRenderer: () => {
        return h("span", { style: { color: "red" } }, [
          h("span", {}, transformI18n("resource.column.p95PodMemPct"))
        ]);
      },
      formatter: ({ p95_pod_mem_pct }) => p95_pod_mem_pct.toFixed(2) + "%"
    },
    {
      label: transformI18n("resource.column.requestMemMb"),
      prop: "request_mem_mb",
      sortable: true,
      headerRenderer: () => {
        return h("span", { style: { color: "red" } }, [
          h("span", {}, transformI18n("resource.column.requestMemMb"))
        ]);
      }
    },
    {
      label: transformI18n("resource.column.podG1gcQpsAi"),
      prop: "pod_g1gc_qps_ai",
      hide: true,
      sortable: true
    },
    {
      label: transformI18n("resource.column.podMemSavedMb"),
      prop: "pod_mem_saved_mb",
      hide: true,
      sortable: true
    },
    {
      label: transformI18n("resource.column.limitMemMb"),
      prop: "limit_mem_mb",
      sortable: true
    },
    {
      label: transformI18n("resource.column.update"),
      prop: "update",
      hide: true,
      sortable: true
    },
    {
      label: transformI18n("resource.column.env"),
      prop: "env",
      hide: true
    },
    {
      label: transformI18n("resource.column.updateAi"),
      prop: "update_ai",
      hide: true
    },
    {
      label: transformI18n("resource.column.operation"),
      // headerRenderer: () =>
      //   h(headerOperator, {
      //     ref: envRef,
      //     props: { isKunlun: isKunlun.value },
      //     style: { textAlign: "center" }
      //   }),
      fixed: "right",
      minWidth: 245,
      slot: "operation"
    }
  ];

  async function onNamespaceChange(val: string) {
    const { data } = await getDeployment(val);
    deploymentList.value = data;
    queryForm.deployment = "";
    onSearch();
  }

  async function onDeploymentChange() {
    onSearch();
  }

  function onKeywordChange() {
    if (searchTimer.value) {
      clearTimeout(searchTimer.value);
    }
    searchTimer.value = setTimeout(() => {
      onSearch();
    }, 300);
  }

  async function onSearch() {
    loading.value = true;
    const { data, meta } = await getResourceList(queryForm);
    dataList.value = data.map(item => {
      let obj: any = {};
      for (let index = 0; index < meta.length; index++) {
        const key = meta[index].name;
        obj[key] = item[index];
        obj.index = index;
      }
      return obj;
    });
    loading.value = false;
  }

  function resetForm() {
    queryForm.namespace = "";
    queryForm.deployment = "";
    queryForm.keyword = "";
    deploymentList.value = [];
    onSearch();
  }

  const editDialogSubmit = (options, row, isSubmit: boolean) => {
    return new Promise<void>(resolve => {
      const FormRef = editFormRef.value.getRef();
      const curData = options.props.formInline as FormItemProps;

      FormRef.validate(async valid => {
        if (valid) {
          if (row?.namespace) {
            // 修改
            editData({
              namespace: curData.namespace,
              deployment: curData.deployment,
              pod_count_manual: curData.pod_count_manual,
              limit_cpu_m: curData.limit_cpu_m,
              limit_mem_mb: curData.limit_mem_mb
            })
              .then(res => {
                console.log(res);
                isSubmit &&
                  message(transformI18n("resource.message.editSuccess"), {
                    type: "success"
                  });
                onSearch();
                resolve();
              })
              .catch(error => {
                isSubmit &&
                  message(transformI18n("resource.message.editFailed"), {
                    type: "error"
                  });
                console.error(error);
              });
          } else {
            // 新增
            addData({
              namespace: curData.namespace,
              deployment: curData.deployment,
              pod_count_manual: curData.pod_count_manual,
              limit_cpu_m: curData.limit_cpu_m,
              limit_mem_mb: curData.limit_mem_mb,
              request_cpu_m: curData.request_cpu_m,
              request_mem_mb: curData.request_mem_mb
            })
              .then(res => {
                console.log(res);
                message(transformI18n("resource.message.createSuccess"), {
                  type: "success"
                });
                resolve();
              })
              .catch(error => {
                message(transformI18n("resource.message.createFailed"), {
                  type: "error"
                });
                console.error(error);
              });
          }
        }
      });
    });
  };

  function openDialog(title = "新增", row?: FormItemProps) {
    let footerButtons = [
      {
        label: transformI18n("resource.operation.saveAndScale"),
        type: "primary",
        btnClick: async ({ dialog: { options, index } }) => {
          await editDialogSubmit(options, row, false);
          const curData = options.props.formInline as FormItemProps;
          await onChangeCapacity(curData);
          closeDialog(options, index);
        }
      },
      {
        label: transformI18n("resource.operation.saveAndReboot"),
        type: "primary",
        btnClick: async ({ dialog: { options, index } }) => {
          await editDialogSubmit(options, row, false);
          await onReboot(row);
          closeDialog(options, index);
        }
      },
      {
        label: transformI18n("buttons.pureSave"),
        type: "primary",
        btnClick: async ({ dialog: { options, index } }) => {
          await editDialogSubmit(options, row, true);
          onSearch();
          closeDialog(options, index);
        }
      },
      {
        label: transformI18n("buttons.pureCancel"),
        btnClick: ({ dialog: { options, index } }) => {
          closeDialog(options, index);
        }
      }
    ] as ButtonProps[];
    addDialog({
      title: `${title == "新增" ? transformI18n("resource.add") : transformI18n("resource.edit")}`,
      props: {
        formInline: {
          namespace: row?.namespace || "",
          deployment: row?.deployment || "",
          pod_count_manual:
            row?.pod_count_manual !== undefined ? row?.pod_count_manual : "",
          limit_cpu_m: row?.limit_cpu_m || "",
          limit_mem_mb: row?.limit_mem_mb || "",
          request_mem_mb: row?.request_mem_mb || "",
          request_cpu_m: row?.request_cpu_m || "",
          pod_count: row?.pod_count !== undefined ? row?.pod_count : ""
        },
        namespace: namespaceList.value,
        isEdit: row?.namespace ? true : false
      },
      width: "46%",
      draggable: true,
      fullscreen: deviceDetection(),
      closeOnClickModal: false,
      contentRenderer: () =>
        h(editForm, { ref: editFormRef, formInline: null }),
      footerButtons:
        title == "新增" ? footerButtons.slice(2, 4) : footerButtons,
      beforeSure: (done, { options }) => {
        const FormRef = editFormRef.value.getRef();
        const curData = options.props.formInline as FormItemProps;

        FormRef.validate(async valid => {
          if (valid) {
            if (row?.namespace) {
              // 修改
              editData({
                namespace: curData.namespace,
                deployment: curData.deployment,
                pod_count_manual: curData.pod_count_manual,
                limit_cpu_m: curData.limit_cpu_m,
                limit_mem_mb: curData.limit_mem_mb
              })
                .then(res => {
                  console.log(res);
                  message(transformI18n("resource.message.editSuccess"), {
                    type: "success"
                  });
                  onSearch();
                  done();
                })
                .catch(error => {
                  message(transformI18n("resource.message.editFailed"), {
                    type: "error"
                  });
                  console.error(error);
                });
            } else {
              // 新增
              addData({
                namespace: curData.namespace,
                deployment: curData.deployment,
                pod_count_manual: curData.pod_count_manual,
                limit_cpu_m: curData.limit_cpu_m,
                limit_mem_mb: curData.limit_mem_mb,
                request_cpu_m: curData.request_cpu_m,
                request_mem_mb: curData.request_mem_mb
              })
                .then(res => {
                  console.log(res);
                  message(transformI18n("resource.message.createSuccess"), {
                    type: "success"
                  });
                  onSearch();
                  done();
                })
                .catch(error => {
                  message(transformI18n("resource.message.createFailed"), {
                    type: "error"
                  });
                  console.error(error);
                });
            }
          }
        });
      }
    });
  }

  function onChangeCapacity(row: any) {
    return new Promise(async resolve => {
      const rowArr = row
        ? [row]
        : tableRef.value.getTableRef().getSelectionRows();
      const params = [];
      const content = rowArr
        .map(row => {
          let podCount = row.pod_count_manual;
          if (podCount === -1) {
            podCount = row.pod_count_ai;
            if (podCount === -1) {
              podCount = row.pod_count;
            }
          }
          const item = {
            namespace: row.namespace,
            deployment_name: row.deployment,
            num: Number(podCount)
          };
          params.push(item);
          return (
            `<div>` +
            `<strong style='margin-right: 5px;'>Namespace: </strong><i><span style='color: red;'>${row.namespace}</span></i>&nbsp;&nbsp;` +
            `<strong style='margin-right: 5px;'>Deployment: </strong><i><span style='color: red;'>${row.deployment}</span></i>&nbsp;&nbsp;` +
            `<strong style='margin-right: 5px;'>Pod数量: </strong><i><span style='color: red;'>${podCount}</span></i>` +
            `</div>`
          );
        })
        .join("<br>");

      addDialog({
        title: transformI18n("resource.scale"),
        props: {
          isScale: true,
          content,
          showInterval: params.length > 1 // 是否显示间隔.
        },
        width: "40%",
        draggable: true,
        fullscreen: deviceDetection(),
        closeOnClickModal: false,
        contentRenderer: () => h(scale, { ref: ScaleRef }),
        beforeSure: async done => {
          const data = await ScaleRef.value.getData();
          let res;
          if (data) {
            if (params.length > 1 || data.type == 1) {
              res = await execCapacity(
                params,
                params.length > 1 ? data.interval : undefined
              );
            } else {
              let tempData = {
                type: "scale",
                service: params,
                time: "",
                cron: ""
              };
              if (data.type == 2) {
                tempData.time = data.time;
                tempData.cron = "";
              } else if (data.type == 3) {
                tempData.time = "";
                tempData.cron = data.cron;
              }
              res = await execTimeCron(tempData);
            }

            if ((res as any).message == "ok" || res == "ok") {
              message(transformI18n("resource.message.editSuccess"), {
                type: "success"
              });
              done();
              resolve(true);
            } else {
              message((res as any).message, {
                type: "error"
              });
            }
          }
        },
        closeCallBack: () => {
          resolve(true);
        }
      });
    });
  }

  function onReboot(row: any) {
    return new Promise(resove => {
      const rowArr = row
        ? [row]
        : tableRef.value.getTableRef().getSelectionRows();
      let params = [];
      const content = rowArr
        .map(row => {
          params.push({
            namespace: row.namespace,
            deployment_name: row.deployment
          });
          return (
            `<div>` +
            `<strong style='margin-right: 5px;'>Namespace: </strong><i><span style='color: red;'>${row.namespace}</span></i>&nbsp;&nbsp;` +
            `<strong style='margin-right: 5px;'>Deployment: </strong><i><span style='color: red;'>${row.deployment}</span></i>&nbsp;&nbsp;` +
            `</div>`
          );
        })
        .join("<br>");

      addDialog({
        title: transformI18n("resource.reboot"),
        width: "40%",
        props: {
          isScale: false,
          content,
          showInterval: params.length > 1
        },
        draggable: true,
        fullscreen: deviceDetection(),
        closeOnClickModal: false,
        contentRenderer: () => h(scale, { ref: ScaleRef }),
        beforeSure: async done => {
          const data = await ScaleRef.value.getData();
          let res;
          if (data) {
            if (params.length > 1 || data.type == 1) {
              res = await rebootResource(
                params,
                params.length > 1 ? data.interval : undefined
              );
            } else {
              let tempData = {
                type: "restart",
                service: params,
                time: "",
                cron: ""
              };
              if (data.type == 2) {
                tempData.time = data.time;
                tempData.cron = "";
              } else if (data.type == 3) {
                tempData.time = "";
                tempData.cron = data.cron;
              }
              res = await execTimeCron(tempData);
            }

            console.log(res);

            if ((res as any).message == "ok" || res == "ok") {
              message(transformI18n("resource.message.editSuccess"), {
                type: "success"
              });
              done();
              resove(true);
            } else {
              message((res as any).message, {
                type: "error"
              });
            }
          }
        },
        closeCallBack: () => {
          resove(true);
        }
      });
    });
  }

  function onSelectionCancel() {
    selectedNum.value = 0;
    // 用于多选表格，清空用户的选择
    tableRef.value.getTableRef().clearSelection();
  }

  function handleSelectionChange(val) {
    selectedNum.value = val.length;
    tableRef.value.setAdaptive();
  }

  onMounted(async () => {
    const { data } = await getNamespace();
    namespaceList.value = data;
    const { data: maxDayData } = await getMaxDay();
    maxDay.value = maxDayData[0];
    onSearch();
  });

  return {
    maxDay,
    namespaceList,
    deploymentList,
    onNamespaceChange,
    onDeploymentChange,
    onKeywordChange,
    queryForm,
    selectedNum,
    onSelectionCancel,
    handleSelectionChange,
    loading,
    columns,
    dataList,
    deviceDetection,
    onSearch,
    resetForm,
    openDialog,
    onChangeCapacity,
    onReboot
  };
}
