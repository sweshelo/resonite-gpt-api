import https from 'https';
import { JSDOM } from 'jsdom';

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

// NGリスト - スクレイピングしても有用な情報を得られないページをリスト化している
const ngSitesList = [
  'https://twitter.com',
  'https://mobile.twitter.com',
  'https://www.youtube.com',
  'https://youtube.com',
  'https://dic.pixiv',
  'https://ototoy.jp',
  'https://mora.jp',
  'https://dic.nicovideo.jp/', // SSLのエラーが出る
]

// Google
export const investigate = async(query: string) => {
  try{
    const googleRequest = await fetch(
      `https://www.google.com/search?q=${query}`,
      {
        agent: httpsAgent,
        headers:{'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/111.0'},
      } as RequestInit
    )
    const html = await googleRequest.text()
    const dom = new JSDOM(html)
    const doc = dom.window.document

    const siteUrls = Array.from(doc.querySelectorAll('h3'))
      .filter((e: Element) => e.parentElement?.tagName === 'A')
      .map((e: Element) => (e.parentElement as HTMLAnchorElement).href)
      .filter((u: string | undefined) => u?.startsWith('https://'));

    const base = [...doc.querySelectorAll('h2')].filter((e) => e.textContent === 'ウェブページから抽出された強調スニペット')[0]?.parentNode?.querySelector('.V3FYCf')
    var content = (base?.querySelector('table'))
      ? base?.querySelector('table')?.innerHTML
      : base?.children[0].children[0].textContent
    var source = { name: base?.querySelector('span.VuuXrf')?.textContent, link: base?.querySelector('a')?.href }
    const urls = [...new Set(siteUrls)].filter((site: string | null) => ngSitesList.map(ngUrl => site?.startsWith(ngUrl)).every(startsWithElement => !startsWithElement)).slice(0, 5)

    // Related
    const related = [...doc.querySelectorAll('div[jsname="yEVEwb"]')].map((e) => e?.querySelector('span')?.textContent)

    console.log({
      snippet: {
        content,
        source,
      },
      related,
      urls,
    })

    return {
      snippet: {
        content,
        source,
      },
      related,
      urls,
    }
  }catch(e){
    console.log(e)
  }
}
