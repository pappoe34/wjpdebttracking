chrome.storage.local.get(['detections'], (data) => {
  const list = (data.detections || []).slice().reverse();
  const el = document.getElementById('list');
  if (!list.length) return;
  el.innerHTML = list.map(d => `
    <div class="det">
      <b>${(d.cardName || 'Unknown card').replace(/[<>&]/g,'')}</b><br>
      ${d.creditLimit ? 'Limit: ' + d.creditLimit + '<br>' : ''}
      ${d.apr ? 'APR: ' + d.apr + '<br>' : ''}
      <span style="opacity:0.6;">${new Date(d.detectedAt).toLocaleDateString()}</span>
    </div>
  `).join('');
});
