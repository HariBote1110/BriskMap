#!/bin/bash
set -e
cd /opt/bench/brisk
: > results.jsonl
for i in 1 2 3 4 5; do for c in keep hide; do
  rm -rf out-$c; mkdir -p out-$c
  cat /opt/bench/worlds/base/region/* > /dev/null
  /usr/bin/time -v -o time-$c-$i.txt java -Xmx8G -jar brisk-extract.jar --in /opt/bench/worlds/base/region --out out-$c --threads 6 --caves $c > run-$c-$i.json 2> run-$c-$i.err
  rss=$(grep "Maximum resident" time-$c-$i.txt | awk "{print \$NF}")
  jq -c --arg i $i --arg rss $rss ". + {run: (\$i|tonumber), max_rss_kb: (\$rss|tonumber)}" run-$c-$i.json >> results.jsonl
done; done
echo DONE >> results.jsonl
