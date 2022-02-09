
export const waitUntil = async (options: {
  pageSize: number,
  pageSizeMinTax: number,
  pageSizeMaxTax: number,
  networkTax: number,
  attempts: number
}) => {
  let resourcesSize = Math.min(1, (options.pageSize / 1024 / 1024 - options.pageSizeMinTax) / options.pageSizeMaxTax);
  await new Promise((resolve) => setTimeout(resolve, options.networkTax * resourcesSize * options.attempts));
}

