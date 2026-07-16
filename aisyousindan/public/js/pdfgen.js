// 2ページ構成のPDFを生成する(vendorしたjsPDFのUMDビルドを使用)

export function buildPdfBase64(page1Canvas, page2Canvas) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.addImage(page1Canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, pageWidth, pageHeight);

  // 2ページ目は内容の分だけの高さで作っているため、下に余白ができないようページ自体もその比率に合わせる
  const page2Height = pageWidth * (page2Canvas.height / page2Canvas.width);
  doc.addPage([pageWidth, page2Height]);
  doc.addImage(page2Canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, pageWidth, page2Height);

  const dataUri = doc.output('datauristring');
  return dataUri.split(',')[1];
}
