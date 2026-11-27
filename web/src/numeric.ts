export const value = (x: any, fallback = 0): number =>
  typeof x === "object" && x !== null && "value" in x
    ? x.value
    : (x ?? fallback);
export const tagged = (x: number) => ({ value: x, source: "user" });
