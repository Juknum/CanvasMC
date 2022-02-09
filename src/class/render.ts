require('dotenv').config();
import http from "http";
import handler from "serve-handler";
import puppeteer from "puppeteer";
import pixelmatch from "pixelmatch";
import fs from "fs";
import path from "path";
import {PNG as png, PNGWithMetadata} from "pngjs"

export class Render {
  public render() {
    // original code: https://github.com/mrdoob/three.js/blob/19beb8ecc83b8f52de1e00dcfca59fc2ce55078f/test/e2e/puppeteer.js

    const port: number = 40;
    const pixelThreshold: number = .2; // threshold error in one pixel
    const maxFailedPixels: number = .05; // total failed pixels

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
      headless: !(process.env.VISIBLE === "true"),
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
          console.warn(`Warning. Wrong request.\n${e}`);
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
            await page.goto(`http://localhost:${port}/src/html/${file}.html`, {
              waitUntil: 'networkidle2',
              timeout: networkTimeout * attemptProgress
            });
          } catch { console.warn('Warning. Network timeout exceeded...'); }

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
              console.log(`Small network timeout. file: ${file}\n${e}`);
              failedScreenshots.push(file);
              continue;
            }

            else {
              console.log('Another attempt...');
              await new Promise((resolve) => setTimeout(resolve, networkTimeout * attemptProgress));
            }
          }

          /* Make or diff? */
          if (process.env.MAKE) {
            /* make screenshots */
            attemptId = maxAttemptId;
            await page.screenshot({ path: path.join(__dirname, `../html/screenshots/${file}.png`), clip: {
              x: 0,
              y: 0,
              width: 1000,
              height: 1000
            } });
            console.log(`File: ${file} generated.`);
          }

          else if (fs.existsSync(path.join(__dirname, `../html/screenshots/${file}.png`))) {
            /* Diff screenshots */

            let actual: PNGWithMetadata = png.sync.read((await page.screenshot()) as Buffer);
            let expected: PNGWithMetadata = png.sync.read(fs.readFileSync(path.join(__dirname, `./html/screenshots/${file}.png`)));
            let diff = new png({ width: actual.width, height: actual.height });

            let numFailedPixels: number;
            try {
              numFailedPixels = pixelmatch(expected.data, actual.data, diff.data, actual.width, actual.height, {
                threshold: pixelThreshold,
                alpha: .2,
                diffMask: process.env.FORCE_COLOR === '0',
                diffColor: process.env.FORCE_COLOR === '0' ? [ 255,255,255 ] : [255,0,0]
              });
            } catch {
              attemptId = maxAttemptId;
              console.warn(`Error! Image sizes does not match in file: ${file}`);
              failedScreenshots.push(file);
              continue;
            }

            numFailedPixels /= actual.width * actual.height;

            /* Print results */
            if (numFailedPixels < maxFailedPixels) {
              attemptId = maxAttemptId;
              console.log(`diff: ${numFailedPixels.toFixed(3)}, file: ${file}`);
            }
            else {
              if (++attemptId === maxAttemptId) {
                console.error(`Error! diff wrong in ${numFailedPixels.toFixed(3)} of pixels in file: ${file}`);
                failedScreenshots.push(file);
                continue;
              }
              else console.log('Another attempt...');
            }
          }
          
          else {
            attemptId = maxAttemptId;
            console.log(`Warning! Screenshot not exists: ${file}`);
            continue;
          }
        } 
      }

      /* Finish */
      if (failedScreenshots.length) {
        if (failedScreenshots.length > 1) console.log('List of failed screenshots: ' + failedScreenshots.join(' '));
        else console.log(`If you sure that all is right, try to run \`npm run make-screenshot ${failedScreenshots[0]}\``);
        console.log(`TEST FAILED! ${failedScreenshots.length} from ${endId - beginId} screenshots not pass.`);
      }
      else if (!process.env.MAKE) {
        console.log(`TEST PASSED! ${endId - beginId} screenshots correctly rendered.`);
      }

      browser.close();
      server.close();
      process.exit(failedScreenshots.length);
    });
  }
}