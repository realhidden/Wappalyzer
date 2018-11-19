const EventEmitter = require('events');

const puppeteer = require('puppeteer');

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


class Browser extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
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
        const value = await this.page.evaluate(({ properties }) => {
          let value = properties
            .reduce((parent, property) => (parent && parent[property]
              ? parent[property] : null), window);

          value = typeof value === 'string' || typeof value === 'number' ? value : !!value;
          return value;
        }, { properties });

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

  async visit(url, cb) {
    if (this.options.debug) {
      console.log(`puppeteer visit: ${url}`);
    }

    this.resources = [];
    this.document.links = [];
    this.document.scripts = [];

    this.window = {};

    let browser = {
      close: () => null,
    };

    try {
      browser = await puppeteer.launch({
        headless: true,
        ignoreHTTPSErrors: true,
      });
      const page = await browser.newPage();
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

      // get common properties b4 navigating
      const commonProperties = await page.evaluate(() => Reflect.ownKeys(window));

      // navigate
      await page.setUserAgent(this.options.userAgent);
      try {
        await Promise.race([
          page.goto(url, { timeout: this.options.waitDuration, waitUntil: 'networkidle2' }).catch((e) => {
          }),
          new Promise(x => setTimeout(x, this.options.waitDuration)),
        ]);
      } catch (e) {
      }

      // get links
      const list = await page.evaluateHandle(() => Array.from(document.getElementsByTagName('a')).map(a => ({
        href: a.href, hostname: a.hostname, pathname: a.pathname, hash: a.hash, protocol: a.protocol,
      })));
      this.document.links = await list.jsonValue();

      // get window props
      /*
      const allProperties = await page.evaluate(() => Reflect.ownKeys(window));
      const customProperties = allProperties.filter(prop => commonProperties.indexOf(prop) === -1);

      for (let i = 0; i < customProperties.length; i++) {
        const prop = customProperties[i];
        try {
          this.window[prop] = await page.evaluate(({ prop }) => {
            const oldrefs = [];
            const jsonSafeMe = function (obj, limit) {
              if (limit > 6) {
                return null;
              }
              oldrefs.push(obj);
              const newObj = {};
              for (const key in obj) {
                if (oldrefs.indexOf(obj[key])!==-1){
                  continue;
                }
                oldrefs.push(obj[key]);
                if (typeof obj[key] === 'function') {
                  newObj[key] = jsonSafeMe(obj[key], limit + 1);
                  continue;
                }
                if (typeof obj[key] === 'object') {
                  newObj[key] = jsonSafeMe(obj[key], limit + 1);
                  continue;
                }
                if ((typeof obj[key] === 'string') || (typeof obj[key] === 'number')) {
                  newObj[key] = obj[key];
                }
              }
              return newObj;
            };
            return jsonSafeMe(window[prop], 0);
          }, { prop });
        } catch (e) {
          console.log(e);
        }
      }
      */

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
      } catch (errCb) {

      }

      // close the page to free up memory
      await page.close();
      this.page = null;

      // close everything
      return await browser.close();
    } catch (err) {
      try {
        await browser.close();
      } catch (err2) {

      }
      if (this.options.debug) {
        console.log(`puppeteer error: ${url}`);
      }
      return cb(err);
    }
  }
}

module.exports = Browser;
