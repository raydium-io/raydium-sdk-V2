export const SESSION_KEY = "ray_tab_hash";
export const STORAGE_KEY = "ray_req_hash";

export const getSessionKey = (): string => {
  if (typeof window === undefined) return "";
  let key = sessionStorage.getItem(SESSION_KEY);

  // new a session key
  if (!key) {
    key = `ray-${Date.now()}`;
    sessionStorage.setItem(SESSION_KEY, key);
  }
  return key;
};

export interface ResHistory {
  status: number;
  url: string;
  params?: any;
  data: any;
  logCount?: number;
  time: number;
  session: string;
  removeLastLog?: boolean;
}

export const updateReqHistory = ({
  logCount = 1000,
  removeLastLog,
  ...resData
}: Omit<ResHistory, "time" | "session">): void => {
  if (typeof window === undefined) return;
  const data: ResHistory[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]").slice(0, logCount - 1);

  // means retry last save error
  if (removeLastLog) data.pop();

  // if data > 1kb
  if (new Blob([JSON.stringify(resData.data)]).size > 1024)
    resData.data = JSON.stringify(resData.data).substring(0, 200) + "...";
  data.unshift({ ...resData, time: Date.now(), session: getSessionKey() });

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // if retry failed, empty request data
    if (removeLastLog) {
      try {
        data[0].data = JSON.stringify(resData.data).substring(0, 100) + "...";
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch {
        data[0].data = "";
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      }
      return;
    }
    updateReqHistory({
      ...resData,
      logCount,
      removeLastLog,
    });
  }
};
