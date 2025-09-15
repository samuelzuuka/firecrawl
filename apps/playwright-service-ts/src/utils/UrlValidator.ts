export class UrlValidator {
  public static isValid(urlString: string): boolean {
    try {
      new URL(urlString);
      return true;
    } catch (_) {
      return false;
    }
  }
}