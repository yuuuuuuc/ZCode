/** 一个正式 Model 的连通性测试结果。 */
export type ModelConnectivityResult =
  | { readonly success: true }
  | {
      readonly success: false;
      readonly error: {
        readonly message: string;
        /** 设置连接测试边界已确认的资格失败；其他执行错误保留原消息。 */
        readonly code?: "provider-unavailable" | "model-unavailable";
      };
    };
