export type GlobalNoticeStore = { getState: () => { latest: null }; subscribe: (fn: () => void) => () => void };
export const browserGlobalNoticeStore: GlobalNoticeStore = {
  getState: () => ({ latest: null }),
  subscribe: () => () => {},
};
