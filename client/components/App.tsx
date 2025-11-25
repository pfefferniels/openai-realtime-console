import { useEffect, useRef, useState } from "react";
import EventLog from "./EventLog";
import SessionControls from "./SessionControls";
import alleluja from "./alleluia.png";
import { MarkerArea, MarkerBaseEditor, MarkerBaseState, CaptionFrameMarker, ShapeMarkerEditor } from "@markerjs/markerjs3";

interface AnnotationWithBounds extends EventItem {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Connection {
  neumeId: number;
  syllableId: number;
  neumeX: number;
  neumeY: number;
  syllableX: number;
  syllableY: number;
}

/**
 * Finds connections between neumes and syllables.
 * Each neume should be connected to the closest syllable that is:
 * - Below the neume (or on the same line)
 * - To the left or horizontally overlapping with the neume
 * - Without crossing (i.e., not jumping into the next line)
 */
function findConnections(events: (EventItem & MarkerBaseState)[]): Connection[] {
  const connections: Connection[] = [];
  
  // Separate neumes and syllables with their bounding boxes
  const neumes: (AnnotationWithBounds & { index: number })[] = [];
  const syllables: (AnnotationWithBounds & { index: number })[] = [];
  
  events.forEach((event, index) => {
    const bounds = event as unknown as AnnotationWithBounds;
    if (typeof bounds.x !== 'number' || typeof bounds.y !== 'number') return;
    
    if (event.type === 'neume-type') {
      neumes.push({ ...bounds, index });
    } else {
      syllables.push({ ...bounds, index });
    }
  });
  
  // For each neume, find the closest syllable below
  for (const neume of neumes) {
    const neumeBottomY = neume.y + neume.height;
    const neumeCenterX = neume.x + neume.width / 2;
    
    let bestSyllable: (AnnotationWithBounds & { index: number }) | null = null;
    let bestDistance = Infinity;
    
    for (const syllable of syllables) {
      const syllableTop = syllable.y;
      const syllableCenterX = syllable.x + syllable.width / 2;
      const syllableLeft = syllable.x;
      const syllableRight = syllable.x + syllable.width;
      
      // Check if syllable is below or at the same level as the neume
      // and horizontally overlapping or to the left
      const isBelow = syllableTop >= neume.y;
      const isHorizontallyValid = neumeCenterX >= syllableLeft - syllable.width &&
                                   neumeCenterX <= syllableRight + syllable.width;
      
      if (isBelow && isHorizontallyValid) {
        // Calculate distance: prioritize vertical closeness, then horizontal
        const verticalDist = syllableTop - neumeBottomY;
        const horizontalDist = Math.abs(neumeCenterX - syllableCenterX);
        
        // Only consider syllables that are reasonably close vertically
        // (avoid jumping to next line - threshold based on typical line height)
        const maxVerticalGap = neume.height * 5; // Reasonable threshold
        if (verticalDist >= 0 && verticalDist < maxVerticalGap) {
          const distance = verticalDist * 2 + horizontalDist; // Weight vertical distance more
          
          if (distance < bestDistance) {
            bestDistance = distance;
            bestSyllable = syllable;
          }
        }
      }
    }
    
    if (bestSyllable) {
      connections.push({
        neumeId: neume.index,
        syllableId: bestSyllable.index,
        neumeX: neume.x + neume.width / 2,
        neumeY: neume.y + neume.height,
        syllableX: bestSyllable.x + bestSyllable.width / 2,
        syllableY: bestSyllable.y
      });
    }
  }
  
  return connections;
}

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
  const [connections, setConnections] = useState<Connection[]>([]);
  const [dataChannel, setDataChannel] = useState<RTCDataChannel | null>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const audioElement = useRef<HTMLAudioElement | null>(null);

  const containerElement = useRef<HTMLDivElement | null>(null);
  const markerArea = useRef<MarkerArea | null>(null);
  const connectionsSvg = useRef<SVGSVGElement | null>(null);

  const activeMarker = useRef<MarkerBaseEditor<AnnotationMarker> | null>(null)

  // Update connections whenever events change
  useEffect(() => {
    const newConnections = findConnections(events);
    setConnections(newConnections);
  }, [events]);

  // Update the connection lines SVG
  useEffect(() => {
    if (!connectionsSvg.current || !markerArea.current) return;

    // Clear existing lines
    while (connectionsSvg.current.firstChild) {
      connectionsSvg.current.removeChild(connectionsSvg.current.firstChild);
    }

    // Draw new connection lines
    for (const conn of connections) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(conn.neumeX));
      line.setAttribute('y1', String(conn.neumeY));
      line.setAttribute('x2', String(conn.syllableX));
      line.setAttribute('y2', String(conn.syllableY));
      line.setAttribute('stroke', '#666');
      line.setAttribute('stroke-width', '1');
      line.setAttribute('stroke-dasharray', '3,2');
      connectionsSvg.current.appendChild(line);
    }
  }, [connections]);

  useEffect(() => {
    if (markerArea.current || !containerElement.current) return;

    const targetImg = document.createElement('img');
    targetImg.src = alleluja;

    markerArea.current = new MarkerArea();
    markerArea.current.registerMarkerType(AnnotationMarker, ShapeMarkerEditor);
    markerArea.current.targetImage = targetImg;
    containerElement.current.appendChild(markerArea.current);

    // Create SVG overlay for connection lines
    // Wait for image to load to get its dimensions
    targetImg.onload = () => {
      if (!containerElement.current || connectionsSvg.current) return;
      
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.style.position = 'absolute';
      svg.style.top = '0';
      svg.style.left = '0';
      svg.style.width = '100%';
      svg.style.height = '100%';
      svg.style.pointerEvents = 'none';
      svg.style.overflow = 'visible';
      
      // Match the viewBox to the image dimensions (MarkerArea's coordinate system)
      svg.setAttribute('viewBox', `0 0 ${targetImg.naturalWidth} ${targetImg.naturalHeight}`);
      svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');
      
      containerElement.current.appendChild(svg);
      connectionsSvg.current = svg;
    };

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
        <div ref={containerElement} className="overflow-y-scroll relative" />

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
