# Kit log

Cost and call time come from the matching request-log response. UNKNOWN means no request-log receipt was available.

| Stage | Attempt | Effort | Reasoning tokens | Seconds | USD | Verdict |
| --- | ---: | --- | ---: | ---: | ---: | --- |
| story | 1 | medium | 516 | 46.772 | 0.04147400 | PASS |
| writer-field-scrub | 1 | n/a | UNKNOWN | 0.000 | 0.00000000 | PASS |
| story-check | 1 | medium | 263 | 14.594 | 0.12562000 | taglineEndWords must name the actual words in the tagline |
| story-check | 2 | high | 1552 | 46.623 | 0.19060000 | filledWhenINotice; chapterShapeWrong; taglineSoundMismatch; end words from code: ["it","it"]; ignored: taglineRhymes: A true rhyme flag requires evidence naming the actual end words, including after local recovery. |
| tagline-end-words | 1 | n/a | UNKNOWN | 0.000 | 0.00000000 | PASS: checker end words recovered from the actual tagline. |
