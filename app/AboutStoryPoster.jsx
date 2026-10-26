import React, { useEffect, useRef, useState } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Link, Stack, Typography } from '@mui/material';
import { GuideSources } from './TeachingLibrary';
import PosterReader from './PosterReader';

const SourceLink = ({ href, children }) => <Link href={href} target="_blank" rel="noreferrer">{children}</Link>;

export default function AboutStoryPoster({ readSample, sampleAvailable = false }) {
  const [open, setOpen] = useState(false), [question, setQuestion] = useState(null), [expandedSources, setExpandedSources] = useState(false);
  const [sample, setSample] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, []);
  const close = () => { request.current++; setLoading(false); setQuestion(null); setExpandedSources(false); setOpen(false); };
  const loadSample = async () => {
    const current = ++request.current; setLoading(true); setError('');
    try {
      const next = await readSample();
      if (!Array.isArray(next?.move?.sources) || !next.move.sources.length) throw Error('The sample is not available right now.');
      if (current === request.current) setSample(next);
    } catch (failure) {
      if (current === request.current) setError(failure.message || 'The sample did not open. Please try again.');
    } finally { if (current === request.current) setLoading(false); }
  };
  const status = <>
    {loading && <Typography role="status">Opening the sample…</Typography>}
    {error && <Alert severity="info" action={<Button size="small" onClick={loadSample} disabled={loading}>Try again</Button>}>{error}</Alert>}
  </>;
  const preview = (label, firstPage, lastPage = firstPage) => <PosterReader result={sample} assetsBase="/api/sample/files/" triggerLabel={label} firstPage={firstPage} lastPage={lastPage} />;
  const questions = [
    ['What is Story Poster?', <Typography><strong>One moment. One skill. One rhyme.</strong> Story Poster turns a hard moment into a story with faces your child knows. Read together and try one small step for next time.</Typography>],
    ['How does it work?', <Typography>Tell us what happened, choose who belongs in the story, and pick a drawing style. The app finds a fitting guide based on research and makes your story and matching pages.</Typography>],
    ['What do we get?', <>
      {sampleAvailable && sample ? <>
        <Typography>A five-page kit. Tap a part to see the sample:</Typography>
        <Stack spacing={.5} sx={{ alignItems: 'flex-start' }}>{preview('poster', 1)}{preview('two-page story', 2, 3)}{preview('Try It page', 4)}{preview('cards with a grown-up guide', 5)}</Stack>
      </> : <Typography>A five-page kit: a poster, a two-page story, a Try It page, and cards with a grown-up guide.</Typography>}
      <Typography>Each kit shares one short reminder. For another topic: <strong>“Not their race. Grow at your pace.”</strong></Typography>
      {sampleAvailable ? status : <Typography variant="body2">The sample preview is not available right now.</Typography>}
    </>],
    ['How is it different from other apps?', <>
      <Typography>Good Inside guides parents. Big Life Journal offers ready-made activities. Nookly and Nuri Tales make personal stories.</Typography>
      <Typography>Story Poster builds around <strong>one hard moment, one practical skill and one short rhyme</strong>, with <strong>familiar faces and matching poster and practice pages</strong>. The rhyme returns word for word when you revisit that skill. Each guide draws on <strong>research and trusted guidance</strong>, with <strong>sources and study limits you can open</strong>.</Typography>
    </>],
    ['Where do the ideas come from?', <>
      <Typography>Our saved guides draw on research found through PubMed and <SourceLink href="https://ies.ed.gov/use-work/education-research-database-eric">ERIC (the U.S. Department of Education’s free research library)</SourceLink>, plus guidance from <SourceLink href="https://www.unicef.org/adolescentkit/activity-box/activity/active-listening">UNICEF</SourceLink> and the <SourceLink href="https://www.cdc.gov/healthy-youth/connecting-conversations/index.html">CDC</SourceLink>. Each guide has source links and notes.</Typography>
      {sampleAvailable && <Accordion className="about-sample-sources" expanded={expandedSources} slotProps={{ transition: { unmountOnExit: true } }} onChange={(_, next) => { setExpandedSources(next); if (next && !sample && !loading) loadSample(); }}>
        <AccordionSummary expandIcon={<span aria-hidden="true">＋</span>}><Typography fontWeight={700}>Sources and limits for the sample</Typography></AccordionSummary>
        <AccordionDetails><Stack spacing={2}>
          <Typography variant="body2">Source links may open a study record or a journal page. Some full papers need paid access.</Typography>
          {status}
          {sample && <GuideSources sources={sample.move.sources} />}
        </Stack></AccordionDetails>
      </Accordion>}
    </>],
    ['What does the research show?', <>
      <Typography>Children ages <strong>9 to 11</strong> remembered more from short readings after answering guiding questions from memory than after rereading. They were tested right afterward. <SourceLink href="https://learninglab.psych.purdue.edu/downloads/2014/2014_Karpicke_etal_JARMAC.pdf">Read the study</SourceLink>.</Typography>
      <Typography>In a study of children averaging <strong>age 10</strong>, lessons a week apart led to better memory for word meanings five weeks later than lessons together. <SourceLink href="https://www.yorku.ca/ncepeda/publications/SCK2011.pdf">Read the study</SourceLink>.</Typography>
      <Typography variant="body2">These are examples from our design research. Story Poster is a tool for reading and practice together, not therapy.</Typography>
    </>],
    ['What if no saved guide fits?', <Typography>The app turns your note into a general topic and searches PubMed and ERIC (the U.S. Department of Education’s free research library). New guides are checked, labelled and linked to their sources.</Typography>],
    ['How long does a story take?', <Typography>A saved guide usually takes less time. A new topic takes longer because the app searches sources and checks the proposed guide. Drawings and page checks also take time. Progress is saved, so you can close the page and return to <strong>Our stories</strong>.</Typography>],
    ['How are my stories and photos kept?', <Typography>Your stories and chosen drawings are saved behind your account. Story Poster removes original uploaded photos after processing. The service making the pictures has its own <SourceLink href="https://help.openai.com/en/articles/8983778-chat-and-file-retention-in-chatgpt">rules for keeping data</SourceLink>.</Typography>],
    ['Could I use my own ChatGPT plan in the future?', <Typography>A future option could let you connect your own eligible ChatGPT plan, if supported by OpenAI. <strong>This is not available in Story Poster yet.</strong> <SourceLink href="https://developers.openai.com/siwc/quickstart">Current requirements</SourceLink>.</Typography>],
  ];
  return <>
    <Button size="small" sx={{ minWidth: 0 }} onClick={() => setOpen(true)}>About</Button>
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm" aria-labelledby="about-story-poster-title">
      <DialogTitle id="about-story-poster-title">About Story Poster</DialogTitle>
      <DialogContent><Stack spacing={1} className="about-story-poster">
        {questions.map(([title, answer], index) => <Accordion key={title} expanded={question === index} slotProps={{ transition: { unmountOnExit: true } }} onChange={(_, next) => {
          setQuestion(next ? index : null);
          if (next && index === 2 && sampleAvailable && !sample && !loading) loadSample();
        }}>
          <AccordionSummary expandIcon={<span aria-hidden="true">＋</span>}><Typography fontWeight={700}>{index + 1}. {title}</Typography></AccordionSummary>
          <AccordionDetails><Stack spacing={2}>{answer}</Stack></AccordionDetails>
        </Accordion>)}
      </Stack></DialogContent>
      <DialogActions><Button onClick={close}>Close</Button></DialogActions>
    </Dialog>
  </>;
}
