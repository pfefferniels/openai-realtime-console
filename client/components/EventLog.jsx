export default function EventLog({ events }) {
  return (
    <div className="flex flex-col gap-2 overflow-x-auto">
      {events.length === 0 ? (
        <div className="text-gray-500">Awaiting events...</div>
      ) : (
        events.map((e, i) => {
          return (
            <div key={`event_${i}`}>
              {e.type}: {e.value}
            </div>
          )
        }))}
    </div>
  );
}
