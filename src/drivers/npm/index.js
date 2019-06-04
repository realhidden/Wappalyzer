const Driver = require('./driver');
const ZombieBrowser = require('./browsers/zombie');
const PuppeteerBrowser = require('./browsers/puppeteer');

class Wappalyzer {
  constructor(pageUrl, options) {
    this.browser = ZombieBrowser;

    return new Driver(this.browser, pageUrl, options);
  }
}

Wappalyzer.browsers = {
  zombie: ZombieBrowser,
  puppeteer: PuppeteerBrowser
};

module.exports = Wappalyzer;
