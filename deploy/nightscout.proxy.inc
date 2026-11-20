proxy_pass http://127.0.0.1:8793;
proxy_http_version 1.1;
proxy_set_header Host $http_host;
proxy_set_header X-Forwarded-Proto https;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header Connection "";
proxy_cache off;
client_max_body_size 32k;
