FROM nginx:alpine

# 移除 Nginx 預設靜態網頁
RUN rm -rf /usr/share/nginx/html/*

# 將前端程式碼複製進映像檔內部
COPY index.html /usr/share/nginx/html/index.html
COPY style.css /usr/share/nginx/html/style.css
COPY app.js /usr/share/nginx/html/app.js

# 複製反向代理設定檔
COPY default.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]