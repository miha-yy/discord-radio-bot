export interface RadioStation {
    name: string;
    stream_url: string;
    website_url?: string;
    type?: string;
    logo?: string;
    region?: string;
    city?: string;
    hashtag?: string;
    frequencies?: string[];
}
export declare function loadStations(stationsPath?: string): Promise<RadioStation[]>;
export declare function getStationsCache(): RadioStation[] | null;
export declare function findStation(stations: RadioStation[], query: string): RadioStation | undefined;
//# sourceMappingURL=radioList.d.ts.map