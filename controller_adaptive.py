"""Adaptive strategy's discovery/initial forwarding app.

The backend owns adaptive decisions; the worker installs priority-200 job rules.
Initial priority-10 forwarding cannot replace those rules. No reactive _heal is
inherited. Existing Baseline/Reactive/FF scripts are unchanged.
"""
from controller_baseline import BaselineController as _InitialForwarding
from ryu.topology import event
from ryu.controller.handler import set_ev_cls


class AdaptiveController(_InitialForwarding):
    @set_ev_cls(event.EventLinkDelete)
    def link_delete(self, ev):
        self.logger.warning('LINK DOWN s%s <-> s%s (adaptive: backend decision pending)',
                            ev.link.src.dpid, ev.link.dst.dpid)
        self._rebuild()
