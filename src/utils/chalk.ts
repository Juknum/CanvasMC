import chalk from "chalk";

export const err = `[${chalk.redBright("ERR")}] `;
export const error = err;
export const warn = `[${chalk.yellow("WARN")}] `;
export const warning = warn;
export const info = `[${chalk.blueBright("INFO")}] `;
export const success = `[${chalk.greenBright("SUCCESS")}] `;