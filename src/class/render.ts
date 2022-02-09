// original code: https://github.com/mrdoob/three.js/blob/19beb8ecc83b8f52de1e00dcfca59fc2ce55078f/test/e2e/puppeteer.js

require('dotenv').config();
import http from "http";
import handler from "serve-handler";
import GIFEncoder from "gifencoder";
import Canvas from "canvas";
import fs from "fs";
import path from "path";
import { success } from "utils/chalk";
import { Browser } from "./browser";

export interface RenderOptions {
  type: "png" | "gif",
  gifOptions?: {
    frames?: number,
    delay?: number,
    repeat?: boolean
  }
}

export class Render {
  private readonly verbose: boolean = process.env.DEV === "true";
  private doGIF: boolean = false;
  private GIFframes: number = 60;
  private GIFDelay: number = 5;
  private GIFRepeat: boolean = true;
  private readonly screenshotHeight = 1000;
  private readonly screenshotWidth = this.screenshotHeight;

  private readonly outputDir: string = path.join(__dirname, "../../output/");

  constructor() {
    this.checkDir(this.outputDir);
  }

  public render(options?: RenderOptions) {
    if (options) {
      this.doGIF = options.type === "gif";

      if (options.gifOptions) {
        if (options.gifOptions.frames) this.GIFframes = options.gifOptions.frames;
        if (options.gifOptions.delay) this.GIFDelay = options.gifOptions.delay;
        if (options.gifOptions.repeat) this.GIFRepeat = options.gifOptions.repeat;
      }
    }

    else {
      this.doGIF = false;
    }

    this.run();
  }

  private checkDir(path: fs.PathLike) {
    if (!fs.existsSync(path)) {
      fs.mkdirSync(path, { recursive: true });
      return this.checkDir(path); // check another time
    }
  }

  private async run() {
    const port: number = 40;

    /* Launch server */
    const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => handler(req, res));
    server.listen(port, async () => {
      
      /* Launch pupeteer with WebGL support in Linux */
      const browser = new Browser({ port: port, verbose: true });
      await browser.launch();
      await browser.loadPage(`/src/html/cube?animated=${this.doGIF}`);
      await browser.evaluatePage();

      if (this.doGIF) await this.renderAsGIF(browser);
      else if (!this.doGIF) await this.renderAsPNG(browser);

      browser.stop();
      server.close();
    });

    server.on('SIGINT', () => process.exit(1));
  }

  private async renderAsGIF(browser: Browser) {
    const outputPath: string = path.join(this.outputDir, "file.gif");
    const encoder = new GIFEncoder(this.screenshotWidth, this.screenshotHeight);
    encoder.start();
    encoder.setRepeat(this.GIFRepeat === true ? 0 : -1);
    encoder.setDelay(this.GIFDelay);

    const canvas = Canvas.createCanvas(this.screenshotWidth, this.screenshotHeight);
    const context = canvas.getContext('2d');

    for (let frame: number = 0; frame < this.GIFframes; frame++) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      
      const screenshot = await Canvas.loadImage(await browser.takeScreenshot());
      
      context.drawImage(
        screenshot,				    			// image
        0, canvas.height,           // sx, sy
        canvas.width, canvas.width,	// sWidth, sHeight
        0, 0,												// dx, dy
        canvas.width, canvas.height	// dWidth, dHeight
      );

      encoder.addFrame(context as CanvasRenderingContext2D);
    }

    encoder.finish();
    fs.writeFileSync(outputPath, encoder.out.getData());

    if (this.verbose) console.log(`${success}GIF file generated: ${outputPath}`);
  }

  private async renderAsPNG(browser: Browser) {
    const outputPath: string = path.join(this.outputDir, "file.png");
    await browser.takeScreenshot(outputPath);

    if (this.verbose) console.log(`${success}PNG file generated: ${outputPath}`);
  }
}