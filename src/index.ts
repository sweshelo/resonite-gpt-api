import express from 'express';
import bodyParser from 'body-parser';
import OpenAI from 'openai';
import https from 'https';
import { JSDOM } from 'jsdom';
import WebSocket from 'ws';
import dotenv from 'dotenv';

import { CheerioWebBaseLoader } from "langchain/document_loaders/web/cheerio";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";

dotenv.config()
const app = express();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
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

app.use(bodyParser.json());

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

// POSTリクエストを処理
app.post('/api/generate', async(req, res) => {
  res.send('Thank you for using resonite ChatGPT. You using old client and this API endpoint was abandoned. Please check it out new client in "Swesh. Public".');
});

// サーバーを起動
const PORT = 8080;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Vector Store
const embedding = new OpenAIEmbeddings()
const store = new MemoryVectorStore(embedding)

// WebSocket
const wss = new WebSocket.Server({port: 8081})

// WebSocket Request
wss.on('connection', (ws) => {
  ws.on('message', async(message) => {
    try{
      console.log(message.toString())
      const request = await JSON.parse(message.toString())

      // Google検索
      if (request.google) {
        ws.send("<STREAM_OPEN>")
        ws.send("<DEBUG_INFO>")
        ws.send("GPT suggesting investigate query ...\n")
        const suggest = await openai.chat.completions.create({
          model: request.model ?? 'gpt-3.5-turbo',
          messages: [
            ...request.thread,
            {
              'role': 'system', 'content': 'Suggest a Google query to help to generate reply. Write down only a query, and follow input language.'
            }
          ]
        })
        const query = suggest.choices[0].message.content
        ws.send(`GPT suggested: ${query}\n`)
        if(!query){
          ws.send("Error.")
          ws.send("<STREAM_CLOSE>")
          return
        }

        ws.send("Google ...\n")
        const siteUrls = await investigate(query)
        ws.send(siteUrls?.join('\n') + '\n' ?? '\n')
        if(!siteUrls){
          ws.send("Error.")
          ws.send("<STREAM_CLOSE>")
          return
        }

        for await (const site of siteUrls){
          try{
            ws.send(`Loading ${site} ... `)
            const docs = await new CheerioWebBaseLoader(site, {
              selector: 'p'
            }).load()
            await store.addDocuments(docs)
            ws.send('Done. \n')
          }catch(e){
            ws.send(`<color=#ff0>[WARN]</color> Failed to build VectorStore from ${site}.\n`)
          }
        }
        ws.send("Completed build VectorStore.")
        ws.send("<STREAM_CLOSE>")
      }

      const lastMessage = request.thread.pop()
      const context = await store.similaritySearch(lastMessage.content, 1);

      const stream = await openai.chat.completions.create({
        model: request.model ?? 'gpt-3.5-turbo',
        messages: [
          ...request.thread,
          { 'role': 'system', 'content': `Context(You can Ignore): ${context[0].pageContent}` },
          lastMessage,
        ],
        stream: true,
      });
      ws.send("<STREAM_OPEN>")
      for await (const part of stream) {
        ws.send(part.choices[0]?.delta?.content || '')
      }
      ws.send("<STREAM_CLOSE>")
    }catch(e){
      console.log(e)
      ws.send("<STREAM_CLOSE>")
      ws.send("<STREAM_OPEN>")
      ws.send("<color=#f00>[ERR]</color> Sorry, something went wrong. TERMINATED.")
      ws.send("<STREAM_CLOSE>")
    }
  });
});

// Google
const investigate = async(query: string) => {
  try{
    const googleRequest = await fetch(
      `https://www.google.com/search?q=${query}`,
      {
        agent: httpsAgent,
        headers:{'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/111.0'},
      } as RequestInit
    )
    const html = await googleRequest.text()
    console.log(html)
    const dom = new JSDOM(html)
    const doc = dom.window.document

    const siteUrls = Array.from(doc.querySelectorAll('h3'))
      .filter((e: Element) => e.parentElement?.tagName === 'A')
      .map((e: Element) => (e.parentElement as HTMLAnchorElement).href)
      .filter((u: string | undefined) => u?.startsWith('https://'));

    return [...new Set(siteUrls)].filter((site: string | null) => ngSitesList.map(ngUrl => site?.startsWith(ngUrl)).every(startsWithElement => !startsWithElement)).slice(0, 5)
  }catch(e){
    console.log(e)
  }
}
