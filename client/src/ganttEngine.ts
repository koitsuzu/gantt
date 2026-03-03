import {
    startOfHour, endOfHour,
    startOfDay, endOfDay,
    startOfWeek, endOfWeek,
    startOfMonth, endOfMonth,
    startOfQuarter, endOfQuarter,
    startOfYear, endOfYear,
    addHours, addDays, addWeeks, addMonths, addQuarters, addYears,
    addMinutes,
    format, differenceInMinutes
} from 'date-fns';
import { zhTW } from 'date-fns/locale';

export type TimeScale = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface TimeScaleConfig {
    unit: TimeScale;
    cellWidth: number;
    format: string;
    subFormat?: string;
}

const SCALE_CONFIGS: Record<TimeScale, TimeScaleConfig> = {
    hour: { unit: 'hour', cellWidth: 50, format: 'H:00', subFormat: 'M/d' },
    day: { unit: 'day', cellWidth: 80, format: 'M/d', subFormat: 'EEE' },
    week: { unit: 'week', cellWidth: 120, format: 'M/d', subFormat: 'yyyy' },
    month: { unit: 'month', cellWidth: 160, format: "M月 ''yy" },
    quarter: { unit: 'quarter', cellWidth: 200, format: "'Q'Q yyyy" },
    year: { unit: 'year', cellWidth: 260, format: 'yyyy' }
};

export class GanttTimeEngine {
    constructor(public scale: TimeScale = 'day') { }

    getCellWidth(): number {
        return SCALE_CONFIGS[this.scale].cellWidth;
    }

    getRange(start: Date, end: Date) {
        const config = SCALE_CONFIGS[this.scale];
        const cells = [];
        let curr = this.getStartOfUnit(start) as Date;
        const limit = this.getEndOfUnit(end);

        while (curr <= limit) {
            cells.push({
                date: new Date(curr),
                label: format(curr, config.format),
                subLabel: config.subFormat ? format(curr, config.subFormat) : ''
            });
            curr = this.addUnit(curr, 1) as Date;
        }
        return cells;
    }

    private getStartOfUnit(date: Date) {
        switch (this.scale) {
            case 'hour': return startOfHour(date);
            case 'day': return startOfDay(date);
            case 'week': return startOfWeek(date, { weekStartsOn: 1 });
            case 'month': return startOfMonth(date);
            case 'quarter': return startOfQuarter(date);
            case 'year': return startOfYear(date);
        }
    }

    private getEndOfUnit(date: Date) {
        switch (this.scale) {
            case 'hour': return endOfHour(date);
            case 'day': return endOfDay(date);
            case 'week': return endOfWeek(date, { weekStartsOn: 1 });
            case 'month': return endOfMonth(date);
            case 'quarter': return endOfQuarter(date);
            case 'year': return endOfYear(date);
        }
    }

    private addUnit(date: Date, amount: number) {
        switch (this.scale) {
            case 'hour': return addHours(date, amount);
            case 'day': return addDays(date, amount);
            case 'week': return addWeeks(date, amount);
            case 'month': return addMonths(date, amount);
            case 'quarter': return addQuarters(date, amount);
            case 'year': return addYears(date, amount);
        }
    }

    private getMinutesPerCell(): number {
        switch (this.scale) {
            case 'hour': return 60;
            case 'day': return 24 * 60;
            case 'week': return 7 * 24 * 60;
            case 'month': return 30 * 24 * 60;
            case 'quarter': return 90 * 24 * 60;
            case 'year': return 365 * 24 * 60;
        }
    }

    getPosition(date: Date, viewStart: Date): number {
        const config = SCALE_CONFIGS[this.scale];
        const start = this.getStartOfUnit(viewStart) as Date;
        const totalMinutes = differenceInMinutes(date, start);
        const minutesPerCell = this.getMinutesPerCell();
        return (totalMinutes / minutesPerCell) * config.cellWidth;
    }

    getDate(position: number, viewStart: Date): Date {
        const config = SCALE_CONFIGS[this.scale];
        const start = this.getStartOfUnit(viewStart) as Date;
        const minutesPerCell = this.getMinutesPerCell();
        const minutes = (position / config.cellWidth) * minutesPerCell;
        return addMinutes(start, Math.round(minutes));
    }
}
