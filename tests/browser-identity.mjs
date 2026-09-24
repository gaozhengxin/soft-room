export async function continueTemporary(page){
 await page.getByRole('button',{name:/使用临时身份继续|Continue with temporary identity/i}).click();
 await page.locator('.shell').waitFor();
}
