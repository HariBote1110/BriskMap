package briskmap.extract;

import java.lang.management.ManagementFactory;
import java.lang.management.ThreadMXBean;

final class Clock {
    private static final ThreadMXBean THREADS = ManagementFactory.getThreadMXBean();
    private static final boolean CPU = THREADS.isCurrentThreadCpuTimeSupported();
    static {
        if (CPU && !THREADS.isThreadCpuTimeEnabled()) THREADS.setThreadCpuTimeEnabled(true);
    }
    private Clock() {}
    static long now() { return CPU ? THREADS.getCurrentThreadCpuTime() : System.nanoTime(); }
}
