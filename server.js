const express = require('express');
const puppeteer = require('puppeteer-extra');
const cors = require('cors');
const proxyAgent = require('proxy-agent');
const randomUseragent = require('random-useragent');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Set up Puppeteer Stealth Plugin
puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

let isStopped = false;
let currentIndex = 0;

async function isProxyWorking(proxy) {
    try {
        const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
        const response = await fetch('https://httpbin.org/ip', {
            method: 'GET',
            headers: { 'User-Agent': 'Mozilla/5.0' },
            agent: new proxyAgent(proxy),
        });
        return response.ok;
    } catch (error) {
        console.error(`Proxy validation failed: ${error.message}`);
        return false;
    }
}

async function sendOtpToNumber(proxy, number, countryName) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: false, // Ensure headless mode is enabled
            slowMo: 50,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--window-size=1920,1080',
                '--disable-infobars',
                '--disable-notifications',
                '--disable-dev-shm-usage',
                '--disable-background-networking',
                '--disable-background-timer-throttling',
                '--disable-renderer-backgrounding',
                proxy ? `--proxy-server=${proxy}` : '',
                '--disable-csp' // Disable CSP for testing purposes
            ],
            defaultViewport: {
                width: Math.floor(Math.random() * (1920 - 1366 + 1)) + 1366,
                height: Math.floor(Math.random() * (1080 - 768 + 1)) + 768,
            },
        });

        const page = await browser.newPage();

        // Randomize User-Agent and other headers
        const userAgent = randomUseragent.getRandom();
        await page.setUserAgent(userAgent);
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Referer': 'https://www.tiktok.com/',
            'Connection': 'keep-alive',
        });

        // Hide WebDriver property and other related properties
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            window.navigator.chrome = { runtime: {} };
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            Object.defineProperty(navigator, 'deviceMemory', { get: () => 4 });
            Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });
        });

        console.log('Navigating to TikTok login page');
        await page.goto('https://www.tiktok.com/login/phone-or-email', { waitUntil: 'networkidle2' });

        // Inject custom script to handle CSP issues (if needed)
        await page.addScriptTag({ content: `
            document.addEventListener('DOMContentLoaded', () => {
                // Example: Inject your own JavaScript if CSP blocks inline scripts
                console.log('CSP handling script injected');
            });
        `});

        console.log('Clicking on the country dropdown');
        await page.waitForSelector('#loginContainer > div.tiktok-aa97el-DivLoginContainer.exd0a430 > form > div.tiktok-15iauzg-DivContainer.ewblsjs0 > div > div.tiktok-1nc4fij-DivAreaSelectionContainer.ewblsjs3 > div.tiktok-1k8r40o-DivAreaLabelContainer.ewblsjs4');
        await page.click('#loginContainer > div.tiktok-aa97el-DivLoginContainer.exd0a430 > form > div.tiktok-15iauzg-DivContainer.ewblsjs0 > div > div.tiktok-1nc4fij-DivAreaSelectionContainer.ewblsjs3 > div.tiktok-1k8r40o-DivAreaLabelContainer.ewblsjs4');

        console.log(`Selecting country: ${countryName}`);
        await page.waitForSelector('#login-phone-search');
        await page.type('#login-phone-search', countryName);

        if (countryName.toLowerCase() === 'india') {
            console.log('Selecting India from dropdown');
            await page.waitForSelector('#IN-91 > span');
            await page.click('#IN-91 > span');
        } else {
            console.log('Pressing Enter for non-India country');
            await page.keyboard.press('Enter');
        }

        console.log('Typing the phone number');
        await page.type('#loginContainer > div.tiktok-aa97el-DivLoginContainer.exd0a430 > form > div.tiktok-15iauzg-DivContainer.ewblsjs0 > div > div.ewblsjs1.tiktok-bl7zoi-DivInputContainer-StyledBaseInput.etcs7ny0 > input', number);

        console.log('Clicking the submit button');
        await page.waitForSelector('#loginContainer > div.tiktok-aa97el-DivLoginContainer.exd0a430 > form > div:nth-child(4) > div > button');
        await page.click('#loginContainer > div.tiktok-aa97el-DivLoginContainer.exd0a430 > form > div:nth-child(4) > div > button');

        // Wait for a period to let the response come in
        console.log('Waiting for 10 seconds');
        await new Promise(resolve => setTimeout(resolve, 10000)); // Alternative to page.waitForTimeout

        return { number, success: true };
    } catch (error) {
        console.error(`Error: ${error.message}`);
        return { number, success: false, error: error.message };
    } finally {
        if (browser) {
            console.log('Closing browser');
            await browser.close();
        }
    }
}

app.post('/send-otp', async (req, res) => {
    const { countryName, proxies, numbers } = req.body;
    const results = [];
    const failedProxies = [];
    const validProxies = [];

    // Validate proxies
    for (const proxy of proxies) {
        if (await isProxyWorking(proxy)) {
            validProxies.push(proxy);
        } else {
            failedProxies.push(proxy);
            console.warn(`Invalid proxy: ${proxy}`);
        }
    }

    const proxyList = validProxies.length ? validProxies : [null]; // Use no proxy if all are invalid

    // Function to process a batch of numbers
    const processBatch = async (batchNumbers) => {
        const batchResults = [];
        for (const number of batchNumbers) {
            const currentProxy = proxyList[Math.floor(currentIndex / 20) % proxyList.length];
            const result = await sendOtpToNumber(currentProxy, number, countryName);
            batchResults.push(result);
        }
        return batchResults;
    };

    let index = 0;
    const batchSize = 10;
    while (index < numbers.length) {
        if (isStopped) break;

        const batchNumbers = numbers.slice(index, index + batchSize);
        const batchResults = await processBatch(batchNumbers);
        results.push(...batchResults);

        index += batchSize;
    }

    res.json({
        data: results,
        failedProxies: failedProxies.length ? failedProxies : ['No failed proxies'],
        message: failedProxies.length ? 'Some proxies were invalid' : 'All proxies were valid'
    });
});

app.post('/stop', (req, res) => {
    isStopped = true;
    res.json({ message: 'Process stopped' });
});

app.post('/resume', (req, res) => {
    isStopped = false;
    res.json({ message: 'Process resumed' });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
