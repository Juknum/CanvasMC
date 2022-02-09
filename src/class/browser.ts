import puppeteer, { Browser as PBrowser, ConsoleMessage, HTTPResponse, Page } from "puppeteer";
import { err, info, warning } from "utils/chalk";
import { waitUntil } from "evaluate/waitUntil";
import { setTHREEOptions } from "evaluate/setTHREEOptions";

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
  constructor(options: { port: number, headless?: boolean, verbose?: boolean }) {
    this.port = options.port;
    if (options.headless !== undefined) this.headless = options.headless;
    if (options.verbose !== undefined) this.verbose = options.verbose;
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
    if (!loop) loop = 1;

    try {
      await this.page.goto(`http://localhost:${this.port}/${path}`, {
        waitUntil: 'networkidle2',
        timeout: this.networkTimeout * (loop ? loop : 1)
      })
    } catch (_err) { // timeout exceeded
      if (this.verbose) console.log(`${warning}Network timeout exceeded for file (attempt: ${loop}) ${path}`);
      this.loadPage(path, loop++).catch(console.error);
    }

    return this;
  }

  /**
   * 
   * @param loop 
   */
  private async evaluateWaitLoad(loop?: number) {
    try {
      if (this.verbose) console.log(`${info}${(loop ? loop : 1)} attempt(s)...`);
      await this.page.evaluate(waitUntil, {
        pageSize: this.pageSize,
        pageSizeMinTax: this.pageSizeMinTax,
        pageSizeMaxTax: this.pageSizeMaxTax,
        networkTax: this.networkTax,
        attempts: (loop ? loop : 1)
      })
    } catch {
      if (loop < 10) this.evaluateWaitLoad(loop++);
      else console.error(`${err}Too much attempts!`);
    }
  }

  /**
   * 
   * @param loop 
   * @returns {Browser}
   */
  public async evaluatePage(options: any): Promise<Browser> {
    await this.page.evaluate(setTHREEOptions, options);
    await this.evaluateWaitLoad();
  
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