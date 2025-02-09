FROM nginx:latest

COPY html /usr/share/nginx/html

# Add a script to check for the environment variable
COPY start.sh /start.sh
RUN chmod +x /start.sh

# Run the script before starting Nginx
CMD ["/bin/bash", "-c", "/start.sh || nginx -g 'daemon off;'"]