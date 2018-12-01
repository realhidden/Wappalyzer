const EventEmitter = require('events');
const { Cluster } = require('puppeteer-cluster');

/*
Current needs:
- OK - browser.document.scripts is a list with script.src
- OK - browser.cookies is a list with cookie.key, cookie.value, cookie.domain, cookie.path,
- OK - browser.document.getElementsByTagName('a')
- OK - browser.resources list with response.status
- OK - browser.document.documentElement
- OK - browser.html()
- OK - browser.window as window object
 */

let cluster = null;

function puppeteerJsEvalFunction({ properties }) {
  let value = properties
    .reduce((parent, property) => (parent && parent[property]
      ? parent[property] : null), window);

  value = typeof value === 'string' || typeof value === 'number' ? value : !!value;
  return value;
}

class Browser extends EventEmitter {
  constructor(options) {
    super();
    this.options = Object.assign({}, {
      puppeteerClusterOptions: {
        concurrency: Cluster.CONCURRENCY_CONTEXT,
        maxConcurrency: 4,
        puppeteerOptions: {
          headless: true,
          ignoreHTTPSErrors: true,
        },
      },
    }, options);
    this.resources = [];

    this.document = {
      documentElement: true,
      getElementsByTagName: () => this.document.links,
      scripts: [],
      links: [],
    };

    this.window = {};
    this.cookies = [];
    this.page = null;
  }

  log(message, source, type) {
    if (this.options.debug) {
      console.log(`[wappalyzer ${type}]`, `[${source}]`, message);
    }
  }

  html() {
    return this.document.html;
  }

  async jsAsync(patterns) {
    const js = {};
    if (!this.page) {
      return js;
    }

    for (const appName of Object.keys(patterns)) {
      js[appName] = {};

      for (const chain of Object.keys(patterns[appName])) {
        js[appName][chain] = {};
        const properties = chain.split('.');

        // grab value from window
        let value = null;

        try {
          value = await this.page.evaluate(puppeteerJsEvalFunction, { properties });
        } catch (err) {
          this.log(err);
        }

        // check value
        if (value) {
          patterns[appName][chain].forEach((pattern, index) => {
            js[appName][chain][index] = value;
          });
        }
      }
    }

    return js;
  }

  async visit(visiturl, visitcb) {
    // start cluster
    if (!cluster) {
      cluster = await Cluster.launch(this.options.puppeteerClusterOptions);
      this.log('Cluster started', 'puppeteer');
      await cluster.task(async ({ page, data: { url, cb, myContext } }) => {
        await myContext.visitInternal(page, url, cb);
      });
    }

    await cluster.queue({ url: visiturl, cb: visitcb, myContext: this });
  }

  async visitInternal(page, url, cb) {
    this.log(`Opening: ${url}`, 'puppeteer');

    this.resources = [];
    this.document.links = [];
    this.document.scripts = [];

    this.window = {};

    try {
      await page.setRequestInterception(true);

      this.page = page;

      page.on('request', (req) => {
        req.continue();
      });

      page.on('response', (res) => {
        if ((res.status() === 301) || (res.status() === 302)) {
          return;
        }
        const headers = res.headers();
        const headList = [];
        Object.keys(headers).forEach((key) => {
          headList.push([key, headers[key]]);
        });

        this.resources.push({
          response: {
            headers: {
              _headers: headList,
            },
            status: res.status(),
          },
        });

        if (headers['content-type'] && (headers['content-type'].indexOf('javascript') !== -1 || headers['content-type'].indexOf('application/') !== -1)) {
          this.document.scripts.push({
            src: res.url(),
          });
        }
      });

      // navigate
      await page.setUserAgent(this.options.userAgent);
      try {
        await Promise.race([
          page.goto(url, { timeout: this.options.waitDuration, waitUntil: 'networkidle2' }),
          new Promise(x => setTimeout(x, this.options.waitDuration)),
        ]);
      } catch (err) {
        this.log(err.toString(), 'puppeteer', 'error');
      }

      // Nothing loaded, really just nothing
      if (this.resources.length === 0){
        try {
          await cb('Nothing loaded...');
        } catch (err) {
          this.log(err.toString(), 'puppeteer', 'error');
        }

        // close the page to free up memory
        await page.close();
        this.page = null;
        return;
      }

      // get links
      const list = await page.evaluateHandle(() => Array.from(document.getElementsByTagName('a')).map(a => ({
        href: a.href,
        hostname: a.hostname,
        pathname: a.pathname,
        hash: a.hash,
        protocol: a.protocol,
      })));
      this.document.links = await list.jsonValue();

      // get cookies
      this.cookies = await page.cookies();
      this.cookies = this.cookies.map((e) => {
        e.key = e.name;
        return e;
      });

      // get html
      this.document.html = await page.content();

      // magic
      try {
        await cb();
      } catch (err) {
        this.log(err.toString(), 'puppeteer', 'error');
      }

      // close the page to free up memory
      await page.close();
      this.page = null;

      // close everything
    } catch (err) {
      this.log(err.toString(), 'puppeteer', 'error');
      cb(err);
    }
  }
}

module.exports = Browser;
