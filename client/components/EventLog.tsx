interface EventItem {
  type: string;
  value: string;
}

interface EventLogProps {
  events: EventItem[];
}

export default function EventLog({ events }: EventLogProps) {
  return (
    <div className="flex flex-col gap-2 overflow-x-auto">
      {events.map((e, i) => {
        return (
          <div key={`event_${i}`}>
            {JSON.stringify(e)}
          </div>
        )
      })}
    </div>
  );
}
