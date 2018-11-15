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
    this.resources = [];

    this.document = {
      documentElement: true,
      getElementsByTagName: () => this.document.links,
      scripts: [],
      links: [],
    };

    this.window = {};
    this.cookies = [];
  }

  html() {
    return this.document.html;
  }

  async visit(url, cb) {
    console.log(`visit: ${url}`);
    const browser = await puppeteer.launch({
      headless: false,
    });
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    this.resources = [];
    this.document.links = [];
    this.document.scripts = [];

    this.window = {};

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
    await page.goto(url);

    // get links
    const list = await page.evaluateHandle(() => Array.from(document.getElementsByTagName('a')).map(a => ({
      href: a.href, hostname: a.hostname, pathname: a.pathname, hash: a.hash, protocol: a.protocol,
    })));
    this.document.links = await list.jsonValue();

    // get window props
    const allProperties = await page.evaluate(() => Reflect.ownKeys(window));
    const customProperties = allProperties.filter(prop => commonProperties.indexOf(prop) === -1);

    for (let i = 0; i < customProperties.length; i++) {
      const prop = customProperties[i];
      try {
        this.window[prop] = await page.evaluate(({ prop }) => window[prop], { prop });
      } catch (e) {
      }
    }

    // get cookies
    this.cookies = await page.cookies();
    this.cookies = this.cookies.map((e) => {
      e.key = e.name;
      return e;
    });

    // get html
    this.document.html = await page.content();

    // magic
    cb();

    // close everything
    await browser.close();
  }
}

module.exports = Browser;
