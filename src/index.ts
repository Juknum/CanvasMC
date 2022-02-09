import { Render } from "class/render";
import { info } from "utils/chalk";

console.log(`${info}Running...`)
const r = new Render();
r.render({
  type: "gif",
  renderOptions: {
    port: 44,
    background: { transparent: true },
  }
});