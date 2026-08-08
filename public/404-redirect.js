// GitHub Pages SPA 重定向：将子路径编码到 query string，由模块入口还原。
const locationState = window.location;
locationState.replace(
  locationState.protocol + '//' + locationState.hostname + (locationState.port ? `:${locationState.port}` : '')
  + `${locationState.pathname.split('/').slice(0, 2).join('/')}/?p=/`
  + locationState.pathname.slice(1).split('/').slice(1).join('/').replace(/&/g, '~and~')
  + (locationState.search ? `&q=${locationState.search.slice(1).replace(/&/g, '~and~')}` : '')
  + locationState.hash,
);
