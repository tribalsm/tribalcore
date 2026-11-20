#!/bin/sh
# Daily reset of the QuizRoom demo: wipe the database and uploaded images, then seed the demo quiz again.
set -eu
systemctl stop quizroom-demo
rm -f /var/lib/quizroom-demo/quiz.db /var/lib/quizroom-demo/quiz.db-wal /var/lib/quizroom-demo/quiz.db-shm
find /opt/quizroom-demo/app/uploads -mindepth 1 -delete
cd /opt/quizroom-demo/app
runuser -u quizroom -- env DATABASE_PATH=/var/lib/quizroom-demo/quiz.db /opt/quizroom-demo/node/bin/node server/seed.js
systemctl start quizroom-demo
