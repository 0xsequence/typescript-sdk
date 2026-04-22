export class TimeUtils {
    static currentTimestampInSecondsString(): string {
        return Math.floor(Date.now()).toString()
    }
}