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
}

export const updateReqHistory = ({ logCount = 1000, ...resData }: Omit<ResHistory, "time" | "session">): void => {
  if (typeof window === undefined) return;
  const data: ResHistory[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]").slice(0, logCount - 1);
  data.unshift({ ...resData, time: Date.now(), session: getSessionKey() });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    data[0].data = JSON.stringify(data[0].data).substring(0, 100) + "...";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }
};
