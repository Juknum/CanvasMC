import puppeteer, { Browser as PBrowser, ConsoleMessage, HTTPResponse, Page } from "puppeteer";
import { err, info, warning } from "utils/chalk";
import fs from "fs";

/*
 * Typescript moment (colorized):
 */
let window: any;
let performance: any;

export class Browser {
  private readonly networkTimeout: number = 6000; 
  private readonly networkTax: number = 2000;     // additional timeout for resources size
  private readonly pageSizeMinTax: number = 1.0;  // in mb, when networkTax = 0
  private readonly pageSizeMaxTax: number = 5.0;  // in mb, when networkTax = networkTax
  private readonly renderTimeout: number = 1200;

  private readonly viewPort: number = 1000;

  private port: number;
  private browser: PBrowser;
  private pages: Array<Page>;
  private page: Page;
  private pageSize: number = 0;
  private headless: boolean = true;
  private verbose: boolean = false;

  /**
   * 
   * @param options 
   */
  constructor(options: {port: number, headless?: boolean, verbose?: boolean}) {
    this.port = options.port;
    if (options.headless) this.headless = options.headless;
    if (options.verbose) this.verbose = options.verbose;
  }

  /**
   * 
   * @param message 
   */
  private console(message: ConsoleMessage) {
    if (message.text().slice(0, 8) === "Warning." && this.verbose)
      console.log(`${warning}${message.text().slice(8)}`);
  }

  /**
   * 
   * @param error 
   */
  private error(error: Error) {
    console.log(`${err}${error.name}\n${error.message}\n${error.stack}\n`);
  }

  /**
   * 
   * @param response
   */
  private async response(response: HTTPResponse) {
    try {
      await response.buffer().then((buff: Buffer) => this.pageSize += buff.length);
    } catch (e) {
      if (this.verbose) console.log(`${warning}Wrong request.\nRequest: ${e}`);
    }
  }

  /**
   * 
   * @returns {Browser}
   */
  public async launch(): Promise<Browser> {
    this.browser = await puppeteer.launch({
      headless: this.headless,
      args: [
        "--use-gl=swiftshader",
        "--no-sandbox",
        "--enable-surface-synchronization"
      ]
    })

    this.pages = await this.browser.pages();
    this.page = this.pages[0];

    await this.page.setViewport({
      width: this.viewPort,
      height: this.viewPort,
    })

    this.page.on('console', (a: any) => this.console(a));
    this.page.on('error', (a: any) => this.error(a));
    this.page.on('response', (a: any) => this.response(a));

    return this;
  }

  /**
   * 
   * @param path 
   * @param loop 
   * @returns {@Browser}
   */
  public async loadPage(path: string, loop?: number): Promise<Browser> {
    try {
      await this.page.goto(`http://localhost:${this.port}/${path}`, {
        waitUntil: 'networkidle2',
        timeout: this.networkTimeout * (loop ? loop : 1)
      })
    } catch (_err) { // timeout exceeded
      if (this.verbose) console.log(`${warning} Network timeout exceeded for file (attempt: ${loop}) ${path}`);
      this.loadPage(path, loop++).catch(console.error);
    }

    return this;
  }

  /**
   * 
   * @param loop 
   * @returns {Browser}
   */
  public async evaluatePage(loop?: number): Promise<Browser> {
    try {
      await this.page.evaluate(async (pageSize: number, pageSizeMinTax: number, pageSizeMaxTax: number, networkTax: number, renderTimeout: number, attempts: number, verbose: boolean) => {
        if (this.verbose) console.log(`${info}First attempt...`);
        let resourcesSize = Math.min(1, (pageSize / 1024 / 1024 - pageSizeMinTax) / pageSizeMaxTax);
        await new Promise((resolve) => setTimeout(resolve, networkTax * resourcesSize * attempts))

        window.chromeRenderStarted = true;
        await new Promise((resolve) => {
          if (typeof performance.wow === "undefined") performance.wow === performance.now;

          let renderStart = performance.wow();
          let waitingLoop = setInterval(() => {
            let renderExceeded = (performance.wow() - renderStart > renderTimeout * attempts);

            if (window.chromeRenderFinished || renderExceeded) {
              if (renderExceeded && verbose) console.log(`${warning}Render timeout exceeded...`);
              clearInterval(waitingLoop);
              resolve(null);
            }
          }, 0);

        });

      }, this.pageSize, this.pageSizeMinTax, this.pageSizeMaxTax, this.networkTax, this.renderTimeout, (loop ? loop : 1), this.verbose);

    } catch (err) {
      if (this.verbose) console.log(`${info}Another attempt...`);
      await new Promise((resolve) => setTimeout(resolve, this.networkTimeout * loop++));
    }

    return this;
  }

  public async takeScreenshot(saveTo?: string): Promise<string | Buffer> {
    const options = {
      path: saveTo,
      clip: {
        x: 0, y: 0,
        width: this.viewPort, height: this.viewPort
      }
    }

    if (!saveTo) delete options.path;

    return await this.page.screenshot(options);
  }

  public stop(): void {
    this.browser.close();
  }
}