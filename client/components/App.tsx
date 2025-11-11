import { useEffect, useRef, useState } from "react";
import EventLog from "./EventLog";
import SessionControls from "./SessionControls";
import alleluja from "./alleluia.png";
import { MarkerArea, MarkerBaseEditor, MarkerBaseState, CaptionFrameMarker, ShapeMarkerEditor } from "@markerjs/markerjs3";

class AnnotationMarker extends CaptionFrameMarker {
  public static typeName = 'AnnotatedHighlightMarker';
  public static title = 'Annotated highlight marker';
  protected static DEFAULT_TEXT = '';

  constructor(container: SVGGElement) {
    super(container);

    this.fontSize = {
      value: 8,
      units: 'pt',
      step: 0.5
    }

    this.strokeColor = 'black';
    this.strokeWidth = 1;
  }

  public setAnnotation(item: EventItem) {
    this.text = `${item.value}`;
    if (item.type === 'neume-type') {
      this.fillColor = 'blue'
    }
    else {
      this.fillColor = 'orange'
    }
  }
}

interface EventItem {
  type: string;
  value: string;
}

export default function App() {
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [events, setEvents] = useState<(EventItem & MarkerBaseState)[]>([]);
  const [dataChannel, setDataChannel] = useState<RTCDataChannel | null>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const audioElement = useRef<HTMLAudioElement | null>(null);

  const containerElement = useRef<HTMLDivElement | null>(null);
  const markerArea = useRef<MarkerArea | null>(null);

  const activeMarker = useRef<MarkerBaseEditor<AnnotationMarker> | null>(null)

  useEffect(() => {
    if (markerArea.current || !containerElement.current) return;

    const targetImg = document.createElement('img');
    targetImg.src = alleluja;

    markerArea.current = new MarkerArea();
    markerArea.current.registerMarkerType(AnnotationMarker, ShapeMarkerEditor);
    markerArea.current.targetImage = targetImg;
    containerElement.current.appendChild(markerArea.current);

    createMarker();
  }, [containerElement, alleluja, markerArea]);

  function createMarker() {
    if (!markerArea.current) return

    activeMarker.current = markerArea.current.createMarker(AnnotationMarker) as MarkerBaseEditor<AnnotationMarker>;
  }

  function handleEvent(item: EventItem) {
    if (!activeMarker.current) return
    const state = activeMarker.current.marker.getBBox()
    activeMarker.current.marker.setAnnotation(item);

    if (!state) {
      console.log('No marker state available');
      return
    }

    setEvents(prev => [...prev, {
      ...item,
      ...(state as any)
    }])

    createMarker()
  }

  async function startSession() {
    // Get a session token for OpenAI Realtime API
    const tokenResponse = await fetch("/token");
    const data = await tokenResponse.json();
    const EPHEMERAL_KEY = data.value;

    // Create a peer connection
    const pc = new RTCPeerConnection();

    // Set up to play remote audio from the model
    audioElement.current = document.createElement("audio");
    audioElement.current.autoplay = true;
    pc.ontrack = (e) => {
      if (audioElement.current) {
        audioElement.current.srcObject = e.streams[0];
      }
    };

    // Add local audio track for microphone input in the browser
    const ms = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });
    pc.addTrack(ms.getTracks()[0]);

    // Set up data channel for sending and receiving events
    const dc = pc.createDataChannel("oai-events");
    setDataChannel(dc);

    // Start the session using the Session Description Protocol (SDP)
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const baseUrl = "https://api.openai.com/v1/realtime/calls";
    const model = "gpt-realtime";
    const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${EPHEMERAL_KEY}`,
        "Content-Type": "application/sdp",
      },
    });

    const sdp = await sdpResponse.text();
    const answer: RTCSessionDescriptionInit = { type: "answer", sdp };
    await pc.setRemoteDescription(answer);

    peerConnection.current = pc;
  }

  // Stop current session, clean up peer connection and data channel
  function stopSession() {
    if (dataChannel) {
      dataChannel.close();
    }

    if (peerConnection.current) {
      peerConnection.current.getSenders().forEach((sender) => {
        if (sender.track) {
          sender.track.stop();
        }
      });

      peerConnection.current.close();
    }

    setIsSessionActive(false);
    setDataChannel(null);
    peerConnection.current = null;
  }

  // Send a message to the model
  function sendClientEvent(message: any) {
    if (dataChannel) {
      const timestamp = new Date().toLocaleTimeString();
      message.event_id = message.event_id || crypto.randomUUID();

      // send event before setting timestamp since the backend peer doesn't expect this field
      dataChannel.send(JSON.stringify(message));

      // if guard just in case the timestamp exists by miracle
      if (!message.timestamp) {
        message.timestamp = timestamp;
      }
      // setEvents((prev) => [message, ...prev]);
    } else {
      console.error(
        "Failed to send message - no data channel available",
        message,
      );
    }
  }

  // Send a text message to the model
  function sendTextMessage(message: string) {
    const event = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: message,
          },
        ],
      },
    };

    sendClientEvent(event);
    sendClientEvent({ type: "response.create" });
  }


  // Attach event listeners to the data channel when a new one is created
  useEffect(() => {
    if (dataChannel) {
      // Append new server events to the list
      dataChannel.addEventListener("message", (e) => {
        const event = JSON.parse(e.data);
        if (!event.timestamp) {
          event.timestamp = new Date().toLocaleTimeString();
        }

        if (event.type.endsWith("delta")) {
          // ignore
        }

        if (event.type === 'response.done') {
          console.log('Response done event:', event);
          if (Array.isArray(event.response?.output)) {
            // console.log('Response output array:', event.response.output.map(o => o.type));
            event.response.output.forEach((output: any) => {
              if (output.type === 'function_call') {
                const callId = output.call_id;
                handleEvent(JSON.parse(output.arguments));

                sendClientEvent({
                  "type": "conversation.item.create",
                  "item": {
                    "type": "function_call_output",
                    "call_id": callId,
                    "output": "received"
                  }
                })
              }
            });
          }
        }
      });

      // Set session active when the data channel is opened
      dataChannel.addEventListener("open", () => {
        setIsSessionActive(true);
        setEvents([]);
      });
    }
  }, [dataChannel]);

  return (
    <>
      <main className="absolute top-16 left-0 right-0 bottom-0">
        <div ref={containerElement} className="overflow-y-scroll" />

        <section className="absolute top-2 right-2 px-4 overflow-y-auto bg-white">
          <EventLog events={events} />
        </section>
        <section className="absolute h-32 left-0 right-0 bottom-0 p-4 bg-gray-100">
          <SessionControls
            startSession={startSession}
            stopSession={stopSession}
            sendTextMessage={sendTextMessage}
            events={events}
            isSessionActive={isSessionActive}
          />
        </section>
      </main>
    </>
  );
}
