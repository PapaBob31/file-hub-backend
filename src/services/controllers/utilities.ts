
export function generateUrlSlug() {
  const alphanumeric = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ123456789'
  let urlSlug = ''
  for (let i=0; i<10; i++) {
    let randomIndex = Math.floor(Math.random() * alphanumeric.length)
    urlSlug += alphanumeric[randomIndex]  
  }
  return urlSlug
}