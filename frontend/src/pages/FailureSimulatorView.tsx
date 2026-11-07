import { ZapOff, RefreshCw } from "lucide-react";
import { RecoveryVerificationCard } from '../components/RecoveryVerificationCard';
import { useSDNStore } from "../stores/sdnStore";
import {
  PageHeader,
  Panel,
  Status,
  EmptyState,
} from "../components/ui/Primitives";

export function FailureSimulatorView() {
  const { topology, setLinkStatus, restoreAllLinks, simulationState, events } =
    useSDNStore();
  const disabled = simulationState !== "RUNNING";
  const reported = (a: string, b: string) =>
    topology.links.some(
      (l) => (l.src === a && l.dst === b) || (l.src === b && l.dst === a),
    );
  const recent = events
    .filter((e) => e.message.includes("Link") || e.message.includes("HEALED"))
    .slice(0, 5);
  return (
    <div className="page failuresimulator-page">
      <PageHeader
        eyebrow="OPERATIONS / FAILURE INJECTION"
        title="Test a broken path"
        description="Disconnect a specific reported link, observe the response, and restore connectivity."
      />
      <RecoveryVerificationCard />
      <Panel title="Common link presets">
        <div className="preset-actions">
          <p className="muted">
            Check the reported active path before injecting a failure. A branch
            may already be unused.
          </p>
          <div>
            <button
              className="button button-danger-outline"
              disabled={disabled || !reported("s1", "s2")}
              onClick={() =>
                setLinkStatus("s1", "s2", "down").catch(console.error)
              }
            >
              <ZapOff size={15} />
              Fail Link (s1 ↔ s2)
            </button>
            <button
              className="button button-danger-outline"
              disabled={disabled || !reported("s1", "s3")}
              onClick={() =>
                setLinkStatus("s1", "s3", "down").catch(console.error)
              }
            >
              <ZapOff size={15} />
              Fail Link (s1 ↔ s3)
            </button>
            <button
              className="button button-quiet"
              disabled={disabled}
              onClick={() => restoreAllLinks().catch(console.error)}
            >
              <RefreshCw size={15} />
              Restore All
            </button>
          </div>
        </div>
      </Panel>
      <Panel title={`Physical links / ${topology.links.length}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                <th className="px-5 py-3">Endpoints</th>
                <th>Reported state</th>
                <th>Interfaces</th>
                <th>Configured capacity / delay</th>
                <th className="px-5">Action</th>
              </tr>
            </thead>
            <tbody>
              {topology.links.map((link) => (
                <tr key={link.id} className="border-t border-slate-800">
                  <td className="px-5 py-5">
                    <code>
                      {link.src} ↔ {link.dst}
                    </code>
                  </td>
                  <td>
                    <Status tone={link.status === "UP" ? "good" : "bad"}>
                      {link.status}
                    </Status>
                  </td>
                  <td className="font-mono text-xs text-slate-400">
                    {link.src_intf || "N/A"}
                    <br />
                    {link.dst_intf || "N/A"}
                  </td>
                  <td className="font-mono text-xs">
                    {link.bw != null ? `${link.bw} Mbps` : "N/A"} /{" "}
                    {link.delay ?? "N/A"}
                  </td>
                  <td className="px-5">
                    <button
                      className={`button ${link.status === "UP" ? "button-danger-outline" : "button-quiet"}`}
                      disabled={disabled}
                      onClick={() =>
                        setLinkStatus(
                          link.src,
                          link.dst,
                          link.status === "UP" ? "down" : "up",
                        ).catch(console.error)
                      }
                    >
                      {link.status === "UP"
                        ? "Disconnect (Inject Failure)"
                        : "Restore Link"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!topology.links.length && (
          <EmptyState title="No links reported">
            Start a simulation to discover the network.
          </EmptyState>
        )}
      </Panel>
      <Panel title="Recent failure and recovery events">
        <div className="panel-body">
          {recent.map((event, i) => (
            <div className="failure-event" key={event.id ?? i}>
              <Status
                tone={
                  event.level === "ERROR"
                    ? "bad"
                    : event.level === "WARNING"
                      ? "warning"
                      : event.level === "SUCCESS"
                        ? "good"
                        : "neutral"
                }
              >
                {event.level}
              </Status>
              <p>{event.message}</p>
              <time dateTime={new Date(event.timestamp * 1000).toISOString()}>
                {new Date(event.timestamp * 1000).toLocaleString()}
              </time>
            </div>
          ))}
          {!recent.length && (
            <EmptyState title="No recent link failure events recorded." />
          )}
        </div>
      </Panel>
    </div>
  );
}
