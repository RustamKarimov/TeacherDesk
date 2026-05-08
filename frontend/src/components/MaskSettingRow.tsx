export function MaskSettingRow({
  label,
  enabled,
  value,
  onEnabled,
  onValue,
}: {
  label: string;
  enabled: boolean;
  value: number;
  onEnabled: (value: boolean) => void;
  onValue: (value: number) => void;
}) {
  return (
    <div className="mask-setting-row">
      <label>
        <input type="checkbox" checked={enabled} onChange={(event) => onEnabled(event.target.checked)} />
        <span>{label}</span>
      </label>
      <input type="number" min="0" value={value} onChange={(event) => onValue(Number(event.target.value))} disabled={!enabled} />
      <span>mm</span>
    </div>
  );
}
