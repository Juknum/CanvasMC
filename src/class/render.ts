require('dotenv').config();
import http from "http";
import handler from "serve-handler";
import puppeteer from "puppeteer";
import GIFEncoder from "gifencoder";
import Canvas from "canvas";
import fs from "fs";
import path from "path";
import { error, info, success, warn } from "utils/chalk";

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

  private run() {
    // original code: https://github.com/mrdoob/three.js/blob/19beb8ecc83b8f52de1e00dcfca59fc2ce55078f/test/e2e/puppeteer.js

    const port: number = 40;

    const networkTimeout: number = 600;
    const networkTax: number = 2000; // additional timeout for resources size
    const pageSizeMinTax: number = 1.0; // in mb, when networkTax = 0
    const pageSizeMaxTax: number = 5.0; // in mb, when networkTax = networkTax
    const renderTimeout: number = 1200;
    const maxAttemptId: number = 3; // progressive attempts
    const progressFunc: Function = (n: number) => 1 + n;

    /* Launch server */
    const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => handler(req, res));
    server.listen(port, async () => await pup);
    server.on('SIGINT', () => process.exit(1));

    /* Launch pupeteer with WebGL support in Linux */
    const pup = puppeteer.launch({
      headless: (process.env.HEADLESS === "true"),
      args: [
        "--use-gl=swiftshader",
        "--no-sandbox",
        "--enable-surface-synchronization"
      ]
    })
    .then(async (browser: puppeteer.Browser) => {
      /* Prepare page */
      const page: puppeteer.Page = (await browser.pages())[0];
      await page.setViewport({ width: 800, height: 600 });

      page.on('console', (msg: puppeteer.ConsoleMessage) => msg.text().slice(0, 8) === 'Warning.' ? console.log(msg.text()) : {});
      page.on('response', async (response: puppeteer.HTTPResponse) => {
        try {
          await response.buffer().then((buffer: Buffer) => pageSize += buffer.length);
        } catch (e) {
          if (this.verbose) console.warn(`${warn}Wrong request.\n${e}`);
        }
      });

      const files: Array<string> = fs.readdirSync(path.join(__dirname, '../html'))
        .filter((s: string) => s.slice(-5) === '.html')
        .map((s: string) => s.slice(0, s.length - 5))

      /* Loop for each file, with CI parallelism */
      let pageSize: number;
      let file: string;
      let attemptProgress: number;
      let failedScreenshots = [];

      const isParallel: boolean = 'CI' in process.env;
      const beginId: number = isParallel ? Math.floor(parseInt(process.env.CI.slice(0, 1)) * files.length / 4) : 0;
      const endId: number = isParallel ? Math.floor((parseInt(process.env.CI.slice(- 1)) + 1) * files.length / 4) : files.length;

      for (let id: number = beginId; id < endId; ++id) {

        /* At least 3 attempts before fail */

        let attemptId = (process.env.MAKE === "true") ? 1 : 0;
        while (attemptId < maxAttemptId) {
          /* load target page */
          file = files[id];
          attemptProgress = progressFunc(attemptId);
          pageSize = 0;

          try {
            await page.goto(`http://localhost:${port}/src/html/${file}?animated=${this.doGIF}`, {
              waitUntil: 'networkidle2',
              timeout: networkTimeout * attemptProgress
            });
          } catch { if (this.verbose) console.log(`${warn}Network timeout exceeded...`); }

          /* render page */
          try {
            /* typescript moment */
            let window: any;
            let performance: any;

            await page.evaluate(async (pageSize, pageSizeMinTax, pageSizeMaxTax, networkTax, renderTimeout, attemptProgress) => {

              /* Resource timeout */
              let resourcesSize = Math.min(1, (pageSize / 1024 / 1024 - pageSizeMinTax) / pageSizeMaxTax);
              await new Promise(resolve => setTimeout(resolve, networkTax * resourcesSize * attemptProgress));

              /* Resolve render promise */
              window.chromeRenderStarted = true;
              await new Promise((resolve) => {
                if (typeof performance.wow === 'undefined') performance.wow === performance.now;

                let renderStart = performance.wow();
                let waitingLoop = setInterval(() => {
                  let renderExceeded = (performance.wow() - renderStart > renderTimeout * attemptProgress);
                  if (window.chromeRenderFinished || renderExceeded) {
                    if (renderExceeded) console.warn('Warning. Render timeout exceeded...');
                    clearInterval(waitingLoop);
                    resolve(null);
                  }
                }, 0);
              });
            }, pageSize, pageSizeMinTax, pageSizeMaxTax, networkTax, renderTimeout, attemptProgress);
          } catch (e) {
            if (++attemptId === maxAttemptId) {
              if (this.verbose) console.log(`${warn}Small network timeout. file: ${file}\n${e}`);
              failedScreenshots.push(file);
              continue;
            }

            else {
              if (this.verbose) console.log(`${info}Another attempt...`);
              await new Promise((resolve) => setTimeout(resolve, networkTimeout * attemptProgress));
            }
          }

          /* make screenshots */
          attemptId = maxAttemptId;

          const screenshotDir: fs.PathLike = path.join(__dirname, "../../screenshots/");
          const outputDir: fs.PathLike = path.join(__dirname, "../../output/");
          this.checkDir(screenshotDir);
          this.checkDir(outputDir);

          if (this.doGIF) {
            const GIFEncoder_ = new GIFEncoder(this.screenshotWidth, this.screenshotHeight);
		        GIFEncoder_.start()
            GIFEncoder_.setRepeat(this.GIFRepeat === true ? 0 : -1);   // 0 for repeat, -1 for no-repeat
            GIFEncoder_.setDelay(this.GIFDelay);  // frame delay in ms

            const canvas = Canvas.createCanvas(this.screenshotWidth, this.screenshotHeight);
            const context = canvas.getContext('2d');

            for (let i = 0; i < this.GIFframes; i++) {
              context.clearRect(0, 0, canvas.width, canvas.height);


              const screenshotPath: fs.PathLike = path.join(screenshotDir, `${file}_${i}.png`);
              await page.screenshot({ 
                path: screenshotPath, 
                clip: { x: 0, y: 0, width: this.screenshotWidth, height: this.screenshotHeight } 
              });
              if (this.verbose) console.log(`${info}File generated: ${screenshotPath}`);

              const screenshot = await Canvas.loadImage(screenshotPath);
              context.drawImage(
                screenshot,				    			// image
                0, canvas.height,           // sx, sy
                canvas.width, canvas.width,	// sWidth, sHeight
                0, 0,												// dx, dy
                canvas.width, canvas.height	// dWidth, dHeight
              )

              GIFEncoder_.addFrame(context as CanvasRenderingContext2D);
            }

            GIFEncoder_.finish();
            const gifPath: fs.PathLike = path.join(outputDir, `${file}.gif`);
            fs.writeFileSync(gifPath, GIFEncoder_.out.getData())
            fs.rmdirSync(screenshotDir, { recursive: true });
            if (this.verbose) console.log(`${success}File generated: ${gifPath}`);
          }

          else {
            const outputPath: fs.PathLike = path.join(outputDir, `${file}.png`)
            await page.screenshot({ 
              path: outputPath, 
              clip: { x: 0, y: 0, width: this.screenshotWidth, height: this.screenshotHeight } 
            });

            if (this.verbose) console.log(`${success}File generated: ${outputPath}`);
          }
        } 
      }

      browser.close();
      server.close();
      process.exit(failedScreenshots.length);
    });
  }
}