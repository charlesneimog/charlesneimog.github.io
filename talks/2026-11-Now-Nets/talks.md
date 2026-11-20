## Slide 1 — Introduction

Hello, everyone.

I have recently joined this group, and today I would like to share some ideas and questions that came from my first experiences with the group in telematic music.

As someone who is new to the group, I have been trying to understand how I can contribute to its artistic and technical research.

One thing that particularly caught my attention was how our technical environment affects the way we work together as artists.

More specifically, I have been thinking about how the way we organize our technology can also influence the way we organize our collective creative processes.

## Slide 2 — Fragmentation of the Technical Environment

This diagram shows part of our current technical setup.

We receive audio from JackTrip, send it through an audio router to Max/MSP, process the sound, and then send it back through the audio router to OBS.

For video, the process is a little more complicated. We receive video from Zoom in OBS. Then, using a virtual camera, we send this video to TouchDesigner. After processing the images, we capture the TouchDesigner window in OBS.

Finally, we use Twitch to broadcast our performance.

Of course, all these tools are very powerful. But when we put them together, we create a very complex and fragmented digital environment.

Each of these tools requires a different kind of technical knowledge.

And I think this fragmentation is not only a technical problem.

## Slide 3 — Fragmentation of Artistic Practice

This technical fragmentation also affects the way we work together as artists.

For example, one person works with sound, another person works with video, and another person controls the transmission.

In this situation, it becomes very easy to identify who is responsible for each part of the artistic work. And I see this as a possible limitation.

It becomes more difficult to enter into each other's creative processes, to change things together, and to experiment with ideas that are outside our individual roles.

For example, I may have an idea about how the sound could interact with the video. But because I do not have enough experience with TouchDesigner, I cannot easily experiment with this idea myself.

I need to explain my idea to another person instead of exploring it directly.

So, even when we perform collectively, some parts of our creative process remain individual.


## Slide 4 — A Shared Technical Environment

So, what happens if we work within the same technical environment?

In our group, for example, most of us have some experience with Max/MSP.

If we can integrate sound, video, and network communication into this environment, perhaps we can also create more opportunities to work together.

## Slide 4.1 — A Shared Technical Environment

Someone who usually works with sound could also experiment with video. Someone who usually works with video could explore different ways of processing sound.

We could also explore the relationship between sound and image without having to create complex connections between different software environments.

The idea is not that everyone needs to do everything, but that everyone has the possibility to participate in different parts of the creative process.

Perhaps this could help us create something that none of us would have imagined individually.

## Slide 5 — Towards a More Organic Environment

With this idea in mind, I have been exploring how to create a more organic technical environment.

An environment where these artistic interactions can happen more naturally, without so many technical barriers between us.

## Slide 6 — p2p: Recent Experiments

For this reason, I recently started developing a project called p2p.

It uses a library called libdatachannel and a small signaling server running on Cloudflare Workers.

The server helps computers find each other. After that, they can communicate directly using WebRTC.

The idea is to exchange audio, video, and messages directly between Max/MSP, Pure Data, and web browsers.

This means that network communication can become part of the patch itself, just like sound synthesis or audio processing.

We can also experiment with different ways of connecting musicians and sharing information between them.

And perhaps, in the future, we could broadcast our performances directly from Max or Pure Data, without using additional software.

This project is still an experiment. But I think it can help us move towards a more integrated artistic environment.

## Slide 7 — Beyond Technical Integration

In the end, my interest is not simply to make our technical setup easier. But a share tecnical enviroment may create new conditions for artistic experimentation, and allow us to develop different ways of working together.

## Slide 8 — Thanks

The project is open source and available on GitHub.

Thank you.
