import type { PluginContext, PluginActivation } from 'alma-plugin-api';

/**
 * Purge — Alma plugin
 *
 * Base skeleton: yetone/alma-plugins → plugins/prompt-enhancer (MIT).
 * What changed:
 *   1. Idempotency. Alma fires `chat.message.willSend` more than once for the
 *      same user message. prompt-enhancer appends blindly, so the directive
 *      stacks up. We embed a fixed marker and skip whenever it is already
 *      present, which makes injection a no-op on the second pass.
 *   2. Presets carrying actual intent (stop-asking / finish-the-task /
 *      anti-hedging) instead of generic formatting advice.
 *   3. A tail-end "boost" line, because a long directive in the middle of a
 *      message gets diluted — what the model reads last carries the most weight.
 *   4. Options that matter are settable, and there is a status command so you
 *      can see what is actually active instead of guessing.
 */

type Preset = 'minimal' | 'standard' | 'strict';

/**
 * Marker must be stable across releases: it is the only thing that lets us tell
 * "I already injected" apart from "the user typed this". Changing it will cause
 * one duplicate injection per live message, so do not change it casually.
 */
const MARKER = '[purge:active]';
const MARKER_RE = /\[purge:active\]/g;

const PRESETS: Record<Preset, string> = {
    minimal: `${MARKER}
Execution mode: do not ask for confirmation on things already implied by the request.`,
    standard: `${MARKER}
Execution mode.
- Act on what was asked. Skip "shall I proceed?" round-trips for steps that are
  already implied by the request.
- If part of the task is blocked, finish everything that is not blocked first,
  then report the blocker with what you already tried.
- Prefer doing and showing over describing what you would do.`,
    strict: `${MARKER}
Execution mode.
- Act on what was asked. Do not ask for confirmation on steps already implied by
  the request.
- Finish the whole task in this turn. If something is genuinely blocked, complete
  every unblocked part first, then state the blocker together with the attempts
  you made and the evidence you have.
- Do not hedge, do not pad, do not restate the request back. Report outcomes,
  not intentions.
- Never claim a step succeeded unless you actually ran it and saw it succeed.`,
};

const BOOST_LINE = 'Directive above is standing policy for this turn: keep executing.';

interface PurgeSettings {
    enabled: boolean;
    preset: Preset;
    boost: boolean;
    customInstructions: string;
    debug: boolean;
}

export async function activate(context: PluginContext): Promise<PluginActivation> {
    const { logger, events, settings, commands, ui } = context;

    logger.info('Purge plugin activated');

    const read = (): PurgeSettings => ({
        enabled: settings.get<boolean>('almaPurge.enabled', false),
        preset: settings.get<Preset>('almaPurge.preset', 'standard'),
        boost: settings.get<boolean>('almaPurge.boost', true),
        customInstructions: settings.get<string>('almaPurge.customInstructions', ''),
        debug: settings.get<boolean>('almaPurge.debug', false),
    });

    const countMarkers = (text: string): number => (text.match(MARKER_RE) ?? []).length;

    const buildDirective = (cfg: PurgeSettings): string => {
        const parts: string[] = [];

        const preset = PRESETS[cfg.preset] ?? PRESETS.standard;
        parts.push(preset);

        const custom = cfg.customInstructions.trim();
        if (custom) {
            parts.push(custom);
        }

        if (cfg.boost) {
            parts.push(BOOST_LINE);
        }

        return parts.join('\n');
    };

    const eventDisposable = events.on(
        'chat.message.willSend',
        (input, output) => {
            const cfg = read();

            if (!cfg.enabled) {
                if (cfg.debug) logger.debug('purge: disabled, skipping');
                return;
            }

            const content = input?.content ?? '';
            if (!content) {
                if (cfg.debug) logger.debug('purge: empty content, skipping');
                return;
            }

            // Idempotency: willSend can fire several times for one message.
            // If the marker survived from a previous pass, do nothing.
            const existing = countMarkers(content);
            if (existing > 0) {
                if (cfg.debug) {
                    logger.debug(`purge: marker already present (${existing}), skipping`);
                }
                return;
            }

            const directive = buildDirective(cfg);
            const finalText = `${content}\n\n${directive}`;

            /**
             * CRITICAL: set `parts`, not just `content`.
             *
             * The host maps the modified content onto EVERY text part of the
             * user message:
             *     n.parts.map(p => p.type === 'text' ? { ...p, text: output.content } : p)
             * A message with two text parts (e.g. an injected timestamp part plus
             * the actual body) therefore gets the directive twice. Replacing the
             * parts array with a single consolidated text part avoids that.
             */
            const parts = Array.isArray(input?.parts) ? input.parts : [];
            const nonTextParts = parts.filter((part: any) => part?.type !== 'text');

            output.parts = [
                ...nonTextParts,
                { type: 'text', text: finalText },
            ];
            // Keep `content` in sync for any consumer that reads it instead of
            // parts. The host prefers `parts` when both are set, so this is a
            // fallback, not a second injection.
            output.content = finalText;


            if (cfg.debug) {
                logger.debug(`purge: injected preset=${cfg.preset} boost=${cfg.boost}`);
            }
        },
        { priority: 50 },
    );

    const toggleDisposable = commands.register('toggle', async () => {
        const next = !settings.get<boolean>('almaPurge.enabled', false);
        await settings.update('almaPurge.enabled', next);
        ui.showNotification(`Purge ${next ? 'enabled' : 'disabled'}`, { type: 'info' });
        logger.info(`Purge ${next ? 'enabled' : 'disabled'}`);
    });

    const statusDisposable = commands.register('status', async () => {
        const cfg = read();
        const state = cfg.enabled ? 'ON' : 'OFF';
        ui.showNotification(
            `Purge ${state} · preset=${cfg.preset} · boost=${cfg.boost ? 'on' : 'off'}`,
            { type: 'info' },
        );
    });

    return {
        dispose: () => {
            logger.info('Purge plugin deactivated');
            eventDisposable.dispose();
            toggleDisposable.dispose();
            statusDisposable.dispose();
        },
    };
}
