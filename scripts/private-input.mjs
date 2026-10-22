import { createInterface } from "node:readline";

// Disable terminal echo before requesting confidential stdin. No file/history.
export async function privateLine() {
  if (!process.stdin.isTTY) {
    const input = createInterface({ input: process.stdin, terminal: false });
    const value = await new Promise((resolve, reject) => {
      input.once("line", resolve);
      input.once("close", () => reject(new Error("Private input was closed.")));
    });
    input.close();
    return value;
  }
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = () => {
      process.stdin.off("data", receive);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };
    const receive = data => {
      for (const character of data.toString()) {
        if (character === "\u0003") { finish(); reject(new Error("Cancelled.")); return; }
        if (character === "\r" || character === "\n") { finish(); resolve(value); return; }
        if (character === "\b" || character === "\u007f") value = value.slice(0,-1);
        else value += character;
      }
    };
    process.stdin.on("data", receive);
  });
}
