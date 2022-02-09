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
  },
  renderOptions?: {
    port?: number,
    background?: {
      transparent?: boolean;
      color?: number;
    }
  }
}

export class Render {
  private readonly verbose: boolean = process.env.DEV === "true";
  private readonly screenshotHeight = 1000;
  private readonly screenshotWidth = this.screenshotHeight;
  private readonly outputDir: string = path.join(__dirname, "../../output/");

  private doGIF: boolean = false;
  private GIFframes: number = 60;
  private GIFDelay: number = 5;
  private GIFRepeat: boolean = true;

  private background: number = 0x000000;
  private isTransparent: boolean = false;

  private port: number = 40;

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

      if (options.renderOptions) {
        if (options.renderOptions.port) this.port = options.renderOptions.port;
        if (options.renderOptions.background) {
          if (options.renderOptions.background.color !== undefined) this.background = options.renderOptions.background.color;
          if (options.renderOptions.background.transparent !== undefined) this.isTransparent = options.renderOptions.background.transparent;
        }
      }

    } else this.doGIF = false;

    this.run();
  }

  private checkDir(path: fs.PathLike) {
    if (!fs.existsSync(path)) {
      fs.mkdirSync(path, { recursive: true });
      return this.checkDir(path); // check another time
    }
  }

  private async run() {
    /* Launch server */
    const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => handler(req, res));
    server.listen(this.port, async () => {
      
      /* Launch pupeteer with WebGL support in Linux */
      const browser = new Browser({ port: this.port, verbose: true, headless: true });
      await browser.launch();
      await browser.loadPage(`/src/page`);
      await browser.evaluatePage({ 
        animated: this.doGIF, 
        background: this.background, 
        transparent: this.isTransparent 
      });

      if (this.doGIF) await this.renderAsGIF(browser);
      else await this.renderAsPNG(browser);

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
    encoder.setTransparent(0);
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

      // remove white pixel when transparent is enabled
      if (this.isTransparent) encoder.addFrame(this.readdTransparency(context) as CanvasRenderingContext2D);
      else encoder.addFrame(context as CanvasRenderingContext2D);
    }

    encoder.finish();
    fs.writeFileSync(outputPath, encoder.out.getData());

    if (this.verbose) console.log(`${success}GIF file generated: ${outputPath}`);
  }

  private async renderAsPNG(browser: Browser) {
    const outputPath: string = path.join(this.outputDir, "file.png");

    if (!this.isTransparent) await browser.takeScreenshot(outputPath);
    else {
      const canvas = Canvas.createCanvas(this.screenshotWidth, this.screenshotHeight);
      let context = canvas.getContext('2d');
      const screenshot = await Canvas.loadImage(await browser.takeScreenshot());
      
      context.drawImage(
        screenshot,				    			// image
        0, canvas.height,           // sx, sy
        canvas.width, canvas.width,	// sWidth, sHeight
        0, 0,												// dx, dy
        canvas.width, canvas.height	// dWidth, dHeight
      );

      context = this.readdTransparency(context);
      fs.writeFileSync(outputPath, canvas.toBuffer('image/png'));
    }

    if (this.verbose) console.log(`${success}PNG file generated: ${outputPath}`);
  }

  private readdTransparency(context: Canvas.CanvasRenderingContext2D): Canvas.CanvasRenderingContext2D {
    let screenData: Canvas.ImageData = context.getImageData(0, 0, this.screenshotWidth, this.screenshotHeight);
    let pix: Uint8ClampedArray = screenData.data;
    
    for (let i:number = 0, n = pix.length; i < n; i+=4) {
      let r: number = pix[i]; let g: number = pix[i+1]; let b: number = pix[i+2];
      if (r === 255 && g === 255 && b === 255) pix[i+3] = 0;
    }

    context.putImageData(screenData, 0, 0);
    return context;
  }
}