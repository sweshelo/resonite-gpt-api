import express from 'express';
import bodyParser from 'body-parser';
import OpenAI from 'openai';
import WebSocket from 'ws';
import dotenv from 'dotenv';
import { investigate } from './google';
import fs from "fs"

import { CheerioWebBaseLoader } from "langchain/document_loaders/web/cheerio";
import { FaissStore } from "langchain/vectorstores/faiss";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import {RecursiveCharacterTextSplitter} from 'langchain/text_splitter';

(async () => {

  dotenv.config()
  const app = express();
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  type User = {
    count: number
  }
  type Users = {
    [key in string]: User;
  }
  const users: Users = {}
  app.use(bodyParser.json());

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
  const store = (fs.existsSync('store')) ? await FaissStore.load('store', embedding) : new FaissStore(embedding, {})

  // WebSocket
  const wss = new WebSocket.Server({port: 8081})

  // WebSocket Request
  wss.on('connection', (ws) => {
    ws.on('message', async(message) => {
      try{
        console.log(message.toString())
        const request = await JSON.parse(message.toString())
        let snippet = null
        let related = null

        // バージョン・ユーザチェック
        if (!request.version || request.version != '2.4') {
          ws.send("<STREAM_OPEN>")
          ws.send("Request rejected: Old version - Please check it out new version in Swesh Public.")
          ws.send("<STREAM_CLOSE>")
          return
        }

        if (!request.user){
          ws.send("<STREAM_OPEN>")
          ws.send("Request rejected: Using custom client? - Please request with UserID.")
          ws.send("<STREAM_CLOSE>")
        }

        // Google検索
        if (request.google) {
          ws.send("<STREAM_OPEN>")
          ws.send("<DEBUG_INFO>")
          ws.send("Debug message ----------------------------\n")
          ws.send("GPT suggesting investigate query ... ")
          const suggest = await openai.chat.completions.create({
            model: request.model ?? 'gpt-3.5-turbo',
            messages: [
              ...request.thread,
              {
                'role': 'system', 'content': 'Generate Google query to search for answers. Write down only a query.'
              }
            ]
          })
          const query = suggest.choices[0].message.content
          ws.send(`Done.\n`)
          if(!query){
            ws.send("Error.")
            ws.send("<STREAM_CLOSE>")
            return
          }

          ws.send("Google ... ")
          const google = await investigate(query)
          ws.send('Done.\n')
          if(!google || !google?.urls){
            ws.send("Error.")
            ws.send("<STREAM_CLOSE>")
            return
          }
          if(google.snippet.content){
            snippet = google.snippet
          }else{
            for await (const site of google.urls){
              try{
                ws.send(`Loading ... `)
                const docs = await new CheerioWebBaseLoader(site, {
                  selector: 'p'
                }).loadAndSplit(
                  new RecursiveCharacterTextSplitter({
                    chunkSize: 150,
                    chunkOverlap: 20,
                    separators: ['\n\n'],
                  })
                )
                await store.addDocuments(docs)
                ws.send(`Done.\n`)
              }catch(e){
                ws.send(`<color=#ff0>[WARN]</color> Failed to build VectorStore from ${site}.\n`)
              }
            }
            await store.save('store');
            ws.send("Completed build VectorStore.")
          }

          if (google.related) related = google.related
          ws.send("<STREAM_CLOSE>")
        }

        const lastMessage = request.thread.pop()

        const date = new Date().toLocaleDateString('ja-JP')
        const context = `Today is ${date}.\n` + (
          (snippet)
          ? `Answers based on the latest information [by ${snippet.source.name}(${snippet.source.link})]: ${snippet.content}`
          : `Context(may based on the latest information but you can ignore it): ${(await store.similaritySearch(lastMessage.content, 3))[0].pageContent}`
        )

        console.log(`Answers based on the latest information [by ${snippet?.source.name}(${snippet?.source.link})]: ${snippet?.content}`)

        const stream = await openai.chat.completions.create({
          model: request.model ?? 'gpt-3.5-turbo',
          messages: [
            ...request.thread,
            { 'role': 'system', 'content': context },
            lastMessage,
          ],
          stream: true,
        });

        ws.send("<STREAM_OPEN>")
        for await (const part of stream) {
          ws.send(part.choices[0]?.delta?.content || '')
        }

        if (snippet){
          ws.send("<CREATE_ASK_WITH_NO_SNIPPET_BUTTON>")
        }

        if (related && related.length > 0) {
          ws.send("<RELATED_QUESTION>")
          for await (const q of related) {
            if (q) ws.send(q)
          }
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

})();
