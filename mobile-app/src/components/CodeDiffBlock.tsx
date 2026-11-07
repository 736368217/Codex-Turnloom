/**
 * Daylight Git Diff card. Data comes ONLY from `GET /api/host/diff`
 * (server.js:7701-7778), never from message.content regex.
 * Accepts the structured `{ repo, clean, files }` shape documented in
 * public/app.js:5374-5400, or a unified `diff`/`patch` string.
 */
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { OptionA } from '@/constants/optionA';
import type { HostDiffResponse } from '@/services/types';

import { EmptyState } from './ui';

export type DiffLine = {
  text: string;
  kind: 'add' | 'del' | 'context';
};

export type CodeDiffBlockProps = {
  /** Verified /api/host/diff payload (may be null when unavailable). */
  diff?: HostDiffResponse | null;
  title?: string;
  /** Pre-parsed lines, useful for tests/preview. */
  lines?: DiffLine[];
  error?: string;
};

/** Parses a unified diff string into coloured rows. */
export function parseUnifiedDiff(raw: string): DiffLine[] {
  return String(raw || '')
    .split('\n')
    .filter((line) => !line.startsWith('--- ') && !line.startsWith('+++ '))
    .map((line) => {
      if (line.startsWith('+')) return { text: line, kind: 'add' as const };
      if (line.startsWith('-')) return { text: line, kind: 'del' as const };
      return { text: line, kind: 'context' as const };
    });
}

export function CodeDiffBlock({ diff, title = '代码改动', lines, error }: CodeDiffBlockProps) {
  const payload = diff?.payload ?? diff;
  const structuredFiles = payload?.files ?? [];
  const raw = payload?.diff ?? payload?.patch ?? '';
  const parsedLines = lines ?? (raw ? parseUnifiedDiff(String(raw)) : []);
  const clean = Boolean(payload?.clean) && structuredFiles.length === 0 && parsedLines.length === 0;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{title}</Text>
        {payload?.repo ? <Text style={styles.repo} numberOfLines={1}>{String(payload.repo)}</Text> : null}
      </View>
      <View style={styles.divider} />

      {error ? (
        <EmptyState title="Diff 暂时不可用" hint={error} />
      ) : clean ? (
        <EmptyState title="工作区干净" hint="暂无文件改动" />
      ) : parsedLines.length === 0 && structuredFiles.length === 0 ? (
        <EmptyState title="暂无 Diff 数据" hint="从 /api/host/diff 获取；不从消息文本猜测" />
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}>
          <View>
            {structuredFiles.map((file, index) => (
              <View key={`${file.path}-${index}`} style={styles.fileRow}>
                <Text style={styles.filePath} numberOfLines={1}>
                  {file.status ? `${file.status}  ` : ''}{file.path}
                </Text>
                <Text style={styles.fileStats}>
                  {file.additions ? `+${file.additions} ` : ''}
                  {file.deletions ? `−${file.deletions}` : ''}
                  {file.binary ? ' binary' : ''}
                </Text>
              </View>
            ))}
            {parsedLines.map((line, index) => (
              <View
                key={`line-${index}`}
                style={[
                  styles.line,
                  line.kind === 'add' && styles.lineAdd,
                  line.kind === 'del' && styles.lineDel,
                ]}>
                <Text
                  selectable
                  style={[
                    styles.lineText,
                    line.kind === 'add' && styles.lineTextAdd,
                    line.kind === 'del' && styles.lineTextDel,
                  ]}>
                  {line.text || ' '}
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: OptionA.card,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(229,229,234,0.7)',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: OptionA.ink,
  },
  repo: {
    flex: 1,
    fontSize: 12,
    color: OptionA.inkSoft,
    textAlign: 'right',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: OptionA.separator,
  },
  scrollContent: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    minWidth: '100%',
  },
  fileRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 3,
  },
  filePath: {
    flex: 1,
    fontSize: 12,
    color: OptionA.ink,
    fontFamily: 'monospace',
  },
  fileStats: {
    fontSize: 12,
    color: OptionA.greenInk,
    fontFamily: 'monospace',
  },
  line: {
    paddingHorizontal: 8,
    paddingVertical: 1,
    borderRadius: 4,
  },
  lineAdd: {
    backgroundColor: OptionA.diffAdd,
  },
  lineDel: {
    backgroundColor: OptionA.diffDel,
  },
  lineText: {
    fontSize: 12,
    lineHeight: 17,
    color: OptionA.ink,
    fontFamily: 'monospace',
  },
  lineTextAdd: {
    color: OptionA.diffAddInk,
  },
  lineTextDel: {
    color: OptionA.diffDelInk,
  },
});
