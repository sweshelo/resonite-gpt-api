FROM node:18
WORKDIR /app
#COPY package*.json ./
#RUN yarn
COPY . .
EXPOSE 8080
EXPOSE 8081

CMD ["npm", "start"]
